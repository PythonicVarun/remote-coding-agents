#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const envFile = path.join(repoRoot, ".env");
const envExample = path.join(repoRoot, ".env.example");

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const checkOnly = process.argv.includes("--check");

function color(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function info(message) {
  console.log(`${color(36, "›")} ${message}`);
}

function warn(message) {
  console.warn(`${color(33, "!")} ${message}`);
}

function fail(message) {
  console.error(`${color(31, "x")} ${message}`);
  process.exit(1);
}

function readDotEnvValue(name) {
  if (!existsSync(envFile)) return "";
  const text = readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] === name) return match[2].trim();
  }
  return "";
}

function ensureNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major < 20) {
    fail(`Node ${process.versions.node} found. This project needs Node 20 or newer.`);
  }
}

function ensureEnvFile() {
  if (existsSync(envFile)) return;
  if (!existsSync(envExample)) {
    fail("Missing .env.example. Run `npm run setup` after restoring the repo files.");
  }
  copyFileSync(envExample, envFile);
  info("Created .env from .env.example.");
}

function ensureDependencies() {
  const required = [
    path.join(repoRoot, "node_modules", "tsx"),
    path.join(repoRoot, "node_modules", "vite"),
  ];
  if (required.every((item) => existsSync(item))) return;
  fail(
    "Dependencies are not installed yet. Run `npm run setup` once, or `npm install --workspaces --include-workspace-root`.",
  );
}

function warnIfAgentImageMissing() {
  const image = readDotEnvValue("AGENT_IMAGE") || "rca-agent:latest";
  const dockerVersion = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });

  if (dockerVersion.status !== 0) {
    warn("Docker is not reachable. The UI will start, but creating sessions will fail until Docker is up.");
    return;
  }

  const inspect = spawnSync("docker", ["image", "inspect", image], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });

  if (inspect.status !== 0) {
    warn(`Docker image "${image}" is missing. Build it once with \`npm run docker:build-agent\`.`);
  }
}

function startChild(label, args) {
  const child = spawn(npmCmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  child.on("error", (err) => {
    console.error(`${color(31, "x")} ${label} failed to start: ${err.message}`);
  });

  return child;
}

async function main() {
  ensureNodeVersion();
  ensureEnvFile();
  ensureDependencies();
  warnIfAgentImageMissing();

  if (checkOnly) {
    info("Startup preflight passed.");
    return;
  }

  info("Starting backend and frontend dev servers. Press Ctrl+C to stop both.");

  const children = [
    startChild("server", ["--workspace", "server", "run", "dev"]),
    startChild("client", ["--workspace", "client", "run", "dev"]),
  ];

  let shuttingDown = false;

  const stopChildren = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (!child.killed) child.kill("SIGINT");
    }
  };

  process.on("SIGINT", stopChildren);
  process.on("SIGTERM", stopChildren);

  const exitCode = await new Promise((resolve) => {
    let settled = false;
    let exited = 0;

    for (const child of children) {
      child.on("exit", (code, signal) => {
        exited += 1;
        if (!settled && !shuttingDown && (code ?? 0) !== 0) {
          settled = true;
          stopChildren();
          resolve(code ?? 1);
          return;
        }
        if (!settled && signal) {
          settled = true;
          stopChildren();
          resolve(0);
          return;
        }
        if (!settled && exited === children.length) {
          settled = true;
          resolve(0);
        }
      });
    }
  });

  process.exit(exitCode);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
