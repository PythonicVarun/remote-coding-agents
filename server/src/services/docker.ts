import Docker from "dockerode";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { config } from "../config.js";
import { badRequest, HttpError, serverError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { allocatePort, releasePort, reservePort } from "./ports.js";
import type { AgentKind, ExtraMount } from "../store/state.js";

const log = logger("docker");

// dockerode auto-detects via DOCKER_HOST / npipe on Windows / unix socket.
export const docker = new Docker();

export async function ensureDockerReady(): Promise<void> {
  try {
    await docker.ping();
  } catch (err) {
    throw serverError(
      "could not reach the Docker daemon — is Docker running and reachable from this user?",
      { cause: String(err) },
    );
  }
}

export async function ensureAgentImage(): Promise<void> {
  try {
    await docker.getImage(config.agentImage).inspect();
  } catch {
    throw serverError(
      `agent image "${config.agentImage}" not found. Run \`npm run docker:build-agent\` first.`,
    );
  }
}

export interface StartContainerOpts {
  /** Logical name surfaced to docker. */
  name: string;
  /** Absolute host path to bind into /workspace. */
  hostProjectPath: string;
  agent: AgentKind;
  /** Optional initial command passed to entrypoint via env. */
  initialCmd?: string;
  /** Start the agent CLI in its resume/latest-conversation mode when supported. */
  resumeLatest?: boolean;
  /** Optional persistent host directory mounted as HOME inside the container. */
  hostAgentHomePath?: string;
  /** Optional ttyd basic-auth credential. */
  ttydAuth?: string;
  /** Extra env vars to forward into the container (caller-supplied). */
  containerEnv?: Record<string, string>;
  /** Additional bind mounts beyond /workspace and /rca-home. */
  extraMounts?: ExtraMount[];
}

/** Translate agent kind into the env vars its CLI looks for. */
function credentialEnvForAgent(agent: AgentKind): string[] {
  switch (agent) {
    case "claude":
      return config.apiKeys.anthropic
        ? [`ANTHROPIC_API_KEY=${config.apiKeys.anthropic}`]
        : [];
    case "codex":
      return config.apiKeys.openai
        ? [`OPENAI_API_KEY=${config.apiKeys.openai}`]
        : [];
    case "gemini": {
      const k = config.apiKeys.gemini;
      // gemini-cli reads either name; pass both so the user doesn't have to care.
      return k ? [`GEMINI_API_KEY=${k}`, `GOOGLE_API_KEY=${k}`] : [];
    }
    case "copilot":
      return config.apiKeys.github ? [`GITHUB_TOKEN=${config.apiKeys.github}`] : [];
    case "shell":
      return [];
  }
}

export interface StartedContainer {
  containerId: string;
  hostTtydPort: number;
}

/**
 * Translate a Windows path (V:\foo\bar) into something the Docker engine accepts.
 * Docker Desktop on Windows accepts forward-slashes ("V:/foo/bar") for bind mounts.
 */
function dockerSrcPath(p: string): string {
  if (os.platform() === "win32") return p.replace(/\\/g, "/");
  return p;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function mapPathRoot(localPath: string, localRoot: string, dockerRoot: string): string | undefined {
  if (!dockerRoot || !isPathInside(localRoot, localPath)) return undefined;
  const rel = path.relative(localRoot, localPath);
  return rel ? path.join(dockerRoot, rel) : dockerRoot;
}

async function sameFsEntry(a: string, b: string): Promise<boolean> {
  try {
    const [aStat, bStat] = await Promise.all([fs.stat(a), fs.stat(b)]);
    return aStat.dev === bStat.dev && aStat.ino === bStat.ino;
  } catch {
    return false;
  }
}

function decodeMountInfoPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

interface MountInfoEntry {
  root: string;
  mountPoint: string;
}

async function readMountInfo(): Promise<MountInfoEntry[]> {
  if (os.platform() === "win32") return [];

  let raw: string;
  try {
    raw = await fs.readFile("/proc/self/mountinfo", "utf8");
  } catch {
    return [];
  }

  const entries: MountInfoEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const sep = line.indexOf(" - ");
    if (sep < 0) continue;
    const fields = line.slice(0, sep).split(" ");
    const root = fields[3];
    const mountPoint = fields[4];
    if (!root || !mountPoint) continue;
    entries.push({
      root: decodeMountInfoPath(root),
      mountPoint: decodeMountInfoPath(mountPoint),
    });
  }
  return entries;
}

async function mountInfoCandidates(localProjectPath: string): Promise<string[]> {
  const entries = await readMountInfo();
  return entries
    .filter((entry) => path.isAbsolute(entry.root) && isPathInside(entry.mountPoint, localProjectPath))
    .sort((a, b) => b.mountPoint.length - a.mountPoint.length)
    .map((entry) => {
      const rel = path.relative(entry.mountPoint, localProjectPath);
      return rel ? path.join(entry.root, rel) : entry.root;
    });
}

async function localCheckoutAliasCandidates(localProjectPath: string): Promise<string[]> {
  if (os.platform() === "win32" || !isPathInside(config.repoRoot, localProjectPath)) {
    return [];
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir("/workspaces", { withFileTypes: true });
  } catch {
    return [];
  }

  const rel = path.relative(config.repoRoot, localProjectPath);
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidateRoot = path.join("/workspaces", entry.name);
    // Some hosted/dev-container environments expose the same checkout at
    // multiple absolute paths. Matching by device+inode keeps this specific
    // to true aliases instead of guessing by directory name.
    if (await sameFsEntry(config.repoRoot, candidateRoot)) {
      candidates.push(rel ? path.join(candidateRoot, rel) : candidateRoot);
    }
  }
  return candidates;
}

async function dockerBindSourceCandidates(localProjectPath: string): Promise<string[]> {
  const candidates = [
    mapPathRoot(localProjectPath, config.projectsRoot, config.dockerHostProjectsRoot),
    mapPathRoot(localProjectPath, config.repoRoot, config.dockerHostWorkspaceRoot),
    ...(await mountInfoCandidates(localProjectPath)),
    ...(await localCheckoutAliasCandidates(localProjectPath)),
    localProjectPath,
  ].filter((candidate): candidate is string => Boolean(candidate));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const src = dockerSrcPath(candidate);
    if (seen.has(src)) continue;
    seen.add(src);
    unique.push(src);
  }
  return unique;
}

interface MountProbeFailure {
  mountSrc: string;
  statusCode?: number;
  error?: string;
}

async function probeDockerBindSource(
  mountSrc: string,
  containerUser: string | undefined,
  markerName: string,
  markerValue: string,
): Promise<MountProbeFailure | null> {
  let container: Docker.Container | undefined;
  try {
    container = await docker.createContainer({
      Image: config.agentImage,
      ...(containerUser ? { User: containerUser } : {}),
      Env: [`RCA_PROBE_MARKER=${markerName}`, `RCA_PROBE_VALUE=${markerValue}`],
      Entrypoint: ["/bin/bash", "-lc"],
      Cmd: [
        [
          "set -euo pipefail",
          'marker="/workspace/${RCA_PROBE_MARKER}"',
          'if [[ ! -f "$marker" ]]; then echo "project marker not visible in bind mount" >&2; exit 20; fi',
          'actual="$(cat "$marker")"',
          'if [[ "$actual" != "$RCA_PROBE_VALUE" ]]; then echo "project marker mismatch in bind mount" >&2; exit 21; fi',
          'probe="/workspace/.rca-write-test-$$"',
          'echo ok > "$probe"',
          'rm -f "$probe"',
        ].join("; "),
      ],
      HostConfig: {
        AutoRemove: false,
        Mounts: [{ Type: "bind", Source: mountSrc, Target: "/workspace" }],
      },
    });
    await container.start();
    const result = await container.wait();
    if (result.StatusCode === 0) return null;
    return { mountSrc, statusCode: result.StatusCode };
  } catch (err) {
    return { mountSrc, error: String(err) };
  } finally {
    if (container) await container.remove({ force: true }).catch(() => undefined);
  }
}

async function selectWritableDockerBindSource(
  localProjectPath: string,
  containerUser: string | undefined,
  label = "project directory",
): Promise<string> {
  const markerName = `.rca-mount-probe-${process.pid}-${Date.now()}-${randomUUID()}`;
  const markerValue = randomUUID();
  const markerPath = path.join(localProjectPath, markerName);

  try {
    await fs.writeFile(markerPath, markerValue, "utf8");
  } catch (err) {
    throw serverError(`${label} is not writable on the host`, {
      path: localProjectPath,
      cause: String(err),
    });
  }

  try {
    const candidates = await dockerBindSourceCandidates(localProjectPath);
    const failures: MountProbeFailure[] = [];

    for (const mountSrc of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const failure = await probeDockerBindSource(mountSrc, containerUser, markerName, markerValue);
      if (!failure) {
        const localSrc = dockerSrcPath(localProjectPath);
        if (mountSrc !== localSrc) {
          log.info("using translated Docker bind source", { localProjectPath, mountSrc });
        }
        return mountSrc;
      }
      failures.push(failure);
    }

    throw serverError(`${label} is not writable inside the container`, {
      localProjectPath,
      candidates: failures,
    });
  } finally {
    await fs.rm(markerPath, { force: true }).catch(() => undefined);
  }
}

async function resolveContainerUser(hostProjectPath: string): Promise<string | undefined> {
  if (os.platform() === "win32") return undefined;
  try {
    const stat = await fs.stat(hostProjectPath);
    if (typeof stat.uid === "number" && typeof stat.gid === "number") {
      return `${stat.uid}:${stat.gid}`;
    }
    log.warn("project uid/gid not numeric; using image default user", {
      hostProjectPath,
    });
  } catch (err) {
    log.warn("failed to inspect project ownership for container user mapping; using image default", {
      hostProjectPath,
      err: String(err),
    });
  }
  return undefined;
}

async function ensureBindSourceWritable(localPath: string): Promise<void> {
  await fs.mkdir(localPath, { recursive: true });
  if (os.platform() !== "win32") {
    await fs.chmod(localPath, 0o777);
  }
}

export async function startSessionContainer(opts: StartContainerOpts): Promise<StartedContainer> {
  await ensureDockerReady();
  await ensureAgentImage();

  const hostPort = await allocatePort();
  const internalPort = "7681/tcp";
  const containerUser = await resolveContainerUser(opts.hostProjectPath);
  const env: string[] = [
    `AGENT_KIND=${opts.agent}`,
    `TTYD_PORT=7681`,
    ...credentialEnvForAgent(opts.agent),
  ];
  if (opts.initialCmd) env.push(`INITIAL_CMD=${opts.initialCmd}`);
  if (opts.resumeLatest) env.push("RCA_AGENT_START_MODE=resume");
  if (opts.hostAgentHomePath) env.push("HOME=/rca-home");
  if (opts.ttydAuth) env.push(`TTYD_AUTH=${opts.ttydAuth}`);
  if (opts.containerEnv) {
    for (const [key, value] of Object.entries(opts.containerEnv)) {
      // Reject anything that looks structurally invalid; let everything else
      // through so callers can pass arbitrary keys (PASCAL_*, custom_*, etc.).
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        throw badRequest(`invalid containerEnv key: ${key}`);
      }
      env.push(`${key}=${value}`);
    }
  }

  let mountSrc: string;
  let homeMountSrc: string | undefined;
  try {
    mountSrc = await selectWritableDockerBindSource(opts.hostProjectPath, containerUser);
    if (opts.hostAgentHomePath) {
      await ensureBindSourceWritable(opts.hostAgentHomePath);
      homeMountSrc = await selectWritableDockerBindSource(
        opts.hostAgentHomePath,
        containerUser,
        "agent home directory",
      );
    }
  } catch (err) {
    releasePort(hostPort);
    throw err;
  }

  const mounts: Docker.MountSettings[] = [
    { Type: "bind", Source: mountSrc, Target: "/workspace" },
  ];
  if (homeMountSrc) {
    mounts.push({ Type: "bind", Source: homeMountSrc, Target: "/rca-home" });
  }
  if (opts.extraMounts && opts.extraMounts.length > 0) {
    for (const m of opts.extraMounts) {
      if (!path.isAbsolute(m.hostPath)) {
        throw badRequest(`extraMounts.hostPath must be absolute: ${m.hostPath}`);
      }
      if (!path.isAbsolute(m.containerPath)) {
        throw badRequest(`extraMounts.containerPath must be absolute: ${m.containerPath}`);
      }
      try {
        await fs.mkdir(m.hostPath, { recursive: true });
      } catch (err) {
        throw badRequest(`extraMounts.hostPath could not be created: ${m.hostPath}`, {
          cause: String(err),
        });
      }
      mounts.push({
        Type: "bind",
        Source: dockerSrcPath(m.hostPath),
        Target: m.containerPath,
        ReadOnly: m.readOnly === true,
      });
    }
  }

  log.info("creating container", {
    name: opts.name,
    hostPort,
    mountSrc,
    homeMountSrc,
    agent: opts.agent,
    resumeLatest: opts.resumeLatest,
  });

  let container: Docker.Container | undefined;
  try {
    container = await docker.createContainer({
      Image: config.agentImage,
      name: opts.name,
      Env: env,
      // Match bind-mounted project ownership on POSIX hosts for write access.
      ...(containerUser ? { User: containerUser } : {}),
      Tty: true,
      OpenStdin: true,
      ExposedPorts: { [internalPort]: {} },
      HostConfig: {
        AutoRemove: false,
        Mounts: mounts,
        PortBindings: {
          [internalPort]: [{ HostPort: String(hostPort), HostIp: "127.0.0.1" }],
        },
        ...(config.containerExtraHosts.length > 0
          ? { ExtraHosts: [...config.containerExtraHosts] }
          : {}),
      },
      Labels: {
        "rca.app": "remote-coding-agents",
        "rca.agent": opts.agent,
      },
    });
    await container.start();
    await verifyWorkspaceWritable(container.id);
  } catch (err) {
    if (container) await container.remove({ force: true }).catch(() => undefined);
    releasePort(hostPort);
    if (err instanceof HttpError) throw err;
    throw serverError("failed to start agent container", { cause: String(err) });
  }

  return { containerId: container.id, hostTtydPort: hostPort };
}

export async function stopAndRemoveContainer(
  containerId: string,
  hostPort: number | undefined,
): Promise<void> {
  try {
    const c = docker.getContainer(containerId);
    try {
      await c.stop({ t: 2 });
    } catch {
      // already stopped is fine
    }
    await c.remove({ force: true });
  } catch (err) {
    log.warn("container cleanup failed (continuing)", { containerId, err: String(err) });
  } finally {
    releasePort(hostPort);
  }
}

export async function inspectContainer(containerId: string) {
  const c = docker.getContainer(containerId);
  return c.inspect();
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function execInContainer(containerId: string, cmd: string[]): Promise<ExecResult> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  docker.modem.demuxStream(stream, stdoutStream, stderrStream);

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    stdoutStream.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    stderrStream.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });

  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? 0,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

export async function verifyWorkspaceWritable(containerId: string): Promise<void> {
  const probe = await execInContainer(containerId, [
    "bash",
    "-lc",
    "set -euo pipefail; probe=/workspace/.rca-write-test-$$; echo ok > \"$probe\"; rm -f \"$probe\"",
  ]);
  if (probe.exitCode !== 0) {
    throw serverError("project directory is not writable inside the container", {
      stdout: probe.stdout.trim(),
      stderr: probe.stderr.trim(),
    });
  }
}

/**
 * On boot, scan for containers we own that may still be running from a
 * previous server run, and re-reserve their host ports. We do NOT auto-stop
 * them — sessions may legitimately still be running. The session store will
 * carry them forward.
 */
export async function adoptRunningSessions(): Promise<void> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ["rca.app=remote-coding-agents"] },
  });
  for (const c of containers) {
    const port = c.Ports?.find((p) => p.PrivatePort === 7681 && p.PublicPort);
    if (port?.PublicPort) reservePort(port.PublicPort);
  }
}
