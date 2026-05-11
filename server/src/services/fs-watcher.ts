// Per-project chokidar watcher. Multiple subscribers (Socket.IO clients) can
// listen on the same project — we keep a single watcher and refcount it.

import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import fs from "node:fs/promises";
import { logger } from "../lib/logger.js";

const log = logger("fs-watcher");

export type FsEventKind = "add" | "addDir" | "change" | "unlink" | "unlinkDir";

export interface FsEvent {
  projectId: string;
  kind: FsEventKind;
  /** POSIX-relative path inside the project. */
  path: string;
  size?: number;
  modified?: string;
}

type Listener = (ev: FsEvent) => void;

interface Entry {
  watcher: FSWatcher;
  projectPath: string;
  listeners: Set<Listener>;
}

const entries = new Map<string, Entry>();

const IGNORE = [
  /(^|[\\/])\.git([\\/]|$)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])\.venv([\\/]|$)/,
  /(^|[\\/])__pycache__([\\/]|$)/,
  /(^|[\\/])\.DS_Store$/,
];

function toRel(projectPath: string, abs: string): string {
  return path.relative(projectPath, abs).split(path.sep).join("/");
}

export function subscribe(projectId: string, projectPath: string, listener: Listener): () => void {
  let entry = entries.get(projectId);
  if (!entry) {
    const watcher = chokidar.watch(projectPath, {
      ignored: IGNORE,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 60 },
    });
    entry = { watcher, projectPath, listeners: new Set() };
    entries.set(projectId, entry);

    const emit = async (kind: FsEventKind, abs: string) => {
      const rel = toRel(projectPath, abs);
      if (!rel || rel === "") return;
      let size: number | undefined;
      let modified: string | undefined;
      if (kind === "add" || kind === "change") {
        try {
          const st = await fs.stat(abs);
          size = st.size;
          modified = st.mtime.toISOString();
        } catch {
          /* ignore */
        }
      }
      const ev: FsEvent = { projectId, kind, path: rel, size, modified };
      for (const l of entry!.listeners) {
        try {
          l(ev);
        } catch (err) {
          log.warn("listener threw", { err: String(err) });
        }
      }
    };

    watcher.on("add", (p) => emit("add", p));
    watcher.on("addDir", (p) => emit("addDir", p));
    watcher.on("change", (p) => emit("change", p));
    watcher.on("unlink", (p) => emit("unlink", p));
    watcher.on("unlinkDir", (p) => emit("unlinkDir", p));
    watcher.on("error", (err) => log.warn("watcher error", { projectId, err: String(err) }));
    log.info("watcher started", { projectId, projectPath });
  }

  entry.listeners.add(listener);
  return () => {
    const e = entries.get(projectId);
    if (!e) return;
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      e.watcher.close().catch(() => undefined);
      entries.delete(projectId);
      log.info("watcher stopped", { projectId });
    }
  };
}

export async function shutdownAll(): Promise<void> {
  for (const [, e] of entries) {
    await e.watcher.close().catch(() => undefined);
  }
  entries.clear();
}
