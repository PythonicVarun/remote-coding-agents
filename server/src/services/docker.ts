import Docker from "dockerode";
import os from "node:os";
import { PassThrough } from "node:stream";
import { config } from "../config.js";
import { serverError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { allocatePort, releasePort, reservePort } from "./ports.js";
import type { AgentKind } from "../store/state.js";

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
  /** Optional ttyd basic-auth credential. */
  ttydAuth?: string;
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

export async function startSessionContainer(opts: StartContainerOpts): Promise<StartedContainer> {
  const hostPort = await allocatePort();
  const internalPort = "7681/tcp";
  const env: string[] = [
    `AGENT_KIND=${opts.agent}`,
    `TTYD_PORT=7681`,
    "HOME=/home/agent",
    ...credentialEnvForAgent(opts.agent),
  ];
  if (opts.initialCmd) env.push(`INITIAL_CMD=${opts.initialCmd}`);
  if (opts.ttydAuth) env.push(`TTYD_AUTH=${opts.ttydAuth}`);

  const mountSrc = dockerSrcPath(opts.hostProjectPath);

  log.info("creating container", { name: opts.name, hostPort, mountSrc, agent: opts.agent });

  let container: Docker.Container;
  try {
    container = await docker.createContainer({
      Image: config.agentImage,
      name: opts.name,
      Env: env,
      // Run sessions as the image's dedicated agent user.
      User: "24542:24542",
      Tty: true,
      OpenStdin: true,
      ExposedPorts: { [internalPort]: {} },
      HostConfig: {
        AutoRemove: false,
        Binds: [`${mountSrc}:/workspace:rw`],
        PortBindings: {
          [internalPort]: [{ HostPort: String(hostPort), HostIp: "127.0.0.1" }],
        },
      },
      Labels: {
        "rca.app": "remote-coding-agents",
        "rca.agent": opts.agent,
      },
    });
    await container.start();
  } catch (err) {
    releasePort(hostPort);
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
