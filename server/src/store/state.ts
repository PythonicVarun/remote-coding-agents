// File-backed JSON store. Single mutex via in-memory write queue.
// Schemas are intentionally permissive on read (forwards-compatible-ish).

import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

const log = logger("store");

export type AgentKind = "claude" | "codex" | "gemini" | "copilot" | "shell";
export type AgentState = "idle" | "running" | "restarting" | "stopped";
export const AGENT_KINDS: readonly AgentKind[] = [
  "claude",
  "codex",
  "gemini",
  "copilot",
  "shell",
] as const;
export type ContainerStrategy = "per-session" | "per-project";

export interface Project {
  id: string;
  name: string;
  slug: string;
  /** Absolute path on host. */
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  agent: AgentKind;
  containerStrategy: ContainerStrategy;
  /** Docker container id, if running. */
  containerId?: string;
  /** Host port currently mapping to ttyd inside the container. */
  ttydPort?: number;
  status: "creating" | "running" | "stopped" | "error";
  lastError?: string;
  agentState?: AgentState;
  agentRestartCount?: number;
  agentLastExitCode?: number;
  agentLastExitAt?: string;
  agentLastCrashAt?: string;
  agentCrashMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface Snapshot {
  projects: Project[];
  sessions: Session[];
}

const STATE_FILE = path.join(config.dataRoot, "state.json");

let cache: Snapshot = { projects: [], sessions: [] };
let loaded = false;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    cache = {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("failed to read state.json, starting fresh", { err: String(err) });
    }
    cache = { projects: [], sessions: [] };
  }
  loaded = true;
}

async function persist(): Promise<void> {
  const tmp = `${STATE_FILE}.tmp`;
  const payload = JSON.stringify(cache, null, 2);
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, STATE_FILE);
}

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readState(): Promise<Snapshot> {
  await load();
  // Clone so callers can't mutate cache.
  return { projects: [...cache.projects], sessions: [...cache.sessions] };
}

export async function mutate<T>(fn: (s: Snapshot) => T | Promise<T>): Promise<T> {
  await load();
  return enqueueWrite(async () => {
    const result = await fn(cache);
    await persist();
    return result;
  });
}
