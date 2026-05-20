// Reconcile the project store with the on-disk projects folder.
//
// Users sometimes delete a project folder directly from the filesystem instead
// of going through the API. Without reconciliation the project entry sticks
// around in state.json and blocks recreation with the same name (slug clash
// causes an unwanted "-2" suffix). This module prunes those ghost entries and
// tears down any sessions that were attached to them — their bind-mounted
// /workspace is gone, so they can't do useful work anyway.

import fs from "node:fs/promises";
import { mutate, readState } from "../store/state.js";
import { stopAndDeleteSession } from "./session-manager.js";
import { logger } from "../lib/logger.js";

const log = logger("project-reconciler");

export async function reconcileProjectsWithDisk(): Promise<void> {
  const snapshot = await readState();
  const stale: { id: string; slug: string; path: string }[] = [];
  for (const p of snapshot.projects) {
    try {
      await fs.access(p.path);
    } catch {
      stale.push({ id: p.id, slug: p.slug, path: p.path });
    }
  }
  if (stale.length === 0) return;

  const staleIds = new Set(stale.map((p) => p.id));
  const orphanedSessions = snapshot.sessions.filter((s) => staleIds.has(s.projectId));

  // Tear down session containers before pruning state so we don't leak
  // sibling containers whose project folder is already gone.
  for (const s of orphanedSessions) {
    await stopAndDeleteSession(s.id).catch((err) => {
      log.warn("failed to stop orphaned session during reconcile (continuing)", {
        sessionId: s.id,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  await mutate((draft) => {
    draft.projects = draft.projects.filter((p) => !staleIds.has(p.id));
    draft.sessions = draft.sessions.filter((s) => !staleIds.has(s.projectId));
  });

  log.info("pruned ghost projects", {
    count: stale.length,
    slugs: stale.map((p) => p.slug),
  });
}
