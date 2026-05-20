import {
  inspectContainer,
  execInContainer,
  startSessionContainer,
  stopAndRemoveContainer,
} from "./docker.js";
import { releasePort } from "./ports.js";
import { agentHomePathForSession } from "./agent-home.js";
import { getSession, listSessions, updateSession } from "../store/sessions.js";
import { getProject } from "../store/projects.js";
import { logger } from "../lib/logger.js";
import type { AgentState, Session } from "../store/state.js";

const log = logger("agent-runtime");
const STATUS_FILE = "/tmp/rca-agent-status.json";
const recoveryInFlight = new Map<string, Promise<void>>();

interface RuntimeSnapshot {
  state: AgentState;
  restartCount: number;
  lastExitCode?: number;
  lastExitAt?: string;
  lastCrashAt?: string;
  lastCrashReason?: string;
}

function changed(session: Session, patch: Partial<Session>): boolean {
  return Object.entries(patch).some(([key, value]) => session[key as keyof Session] !== value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recoveryDedupeKey(session: Session, oldContainerId: string): string {
  return session.containerStrategy === "per-project"
    ? `${session.projectId}:${oldContainerId}`
    : `${session.id}:${oldContainerId}`;
}

async function readRuntimeSnapshot(containerId: string): Promise<RuntimeSnapshot | null> {
  const result = await execInContainer(containerId, ["cat", STATUS_FILE]);
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) return null;

  try {
    const parsed = JSON.parse(result.stdout) as Partial<RuntimeSnapshot>;
    if (typeof parsed.state !== "string" || typeof parsed.restartCount !== "number") {
      return null;
    }
    return {
      state: parsed.state as AgentState,
      restartCount: parsed.restartCount,
      lastExitCode: typeof parsed.lastExitCode === "number" ? parsed.lastExitCode : undefined,
      lastExitAt: typeof parsed.lastExitAt === "string" ? parsed.lastExitAt : undefined,
      lastCrashAt: typeof parsed.lastCrashAt === "string" ? parsed.lastCrashAt : undefined,
      lastCrashReason:
        typeof parsed.lastCrashReason === "string" ? parsed.lastCrashReason : undefined,
    };
  } catch (err) {
    log.warn("failed to parse agent runtime snapshot", {
      containerId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Applies runtime patches to every running session that currently points to the
 * same container id (used by per-project shared containers).
 * patchFactory receives each current session so patch fields can be computed
 * per session (for example counters that increment from that session's state).
 * Returns the refreshed record for `session.id` when available. If it disappears
 * during recovery (for example deleted concurrently), we return the original
 * in-memory object as a best-effort fallback for the current sync call.
 */
async function updateSessionsForContainer(
  session: Session,
  oldContainerId: string,
  patchFactory: (s: Session) => Partial<Session>,
): Promise<Session> {
  const peers = await listSessions(session.projectId);
  const targetIds = peers
    .filter((x) => x.status === "running" && x.containerId === oldContainerId)
    .map((x) => x.id);
  if (!targetIds.includes(session.id)) {
    targetIds.push(session.id);
  }

  const updates = await Promise.all(
    targetIds.map(async (id) => {
      const existing = await getSession(id).catch(() => null);
      if (!existing) return { id, value: null };
      const patch = patchFactory(existing);
      if (!changed(existing, patch)) return { id, value: existing };
      const updated = await updateSession(id, patch);
      return { id, value: updated };
    }),
  );
  const current = updates.find((x) => x.id === session.id)?.value;
  return current ?? session;
}

async function hasInteractiveRuntime(containerId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await execInContainer(containerId, ["tmux", "has-session", "-t", "agent"]);
      if (result.exitCode === 0) return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
  return false;
}

async function recoverSessionContainer(
  session: Session,
  opts: { exitCode?: number; reason?: string },
): Promise<Session> {
  if (session.status !== "running" || !session.containerId) return session;
  const oldContainerId = session.containerId;
  const dedupeKey = recoveryDedupeKey(session, oldContainerId);

  const existingRecovery = recoveryInFlight.get(dedupeKey);
  if (existingRecovery) {
    await existingRecovery;
    return getSession(session.id).catch(() => session);
  }

  const recovery = (async () => {
    const now = new Date().toISOString();
    const reason =
      opts.reason ??
      `session container exited${
        typeof opts.exitCode === "number" ? ` (code ${opts.exitCode})` : ""
      }; restarted automatically`;

    // Re-check the session right before doing irreversible work. If it was
    // marked stopped (e.g. user is mid-delete) or removed entirely while this
    // closure waited on the dedupe lock, bail out so we don't spawn a
    // replacement container the user no longer wants.
    const current = await getSession(session.id).catch(() => null);
    if (!current || current.status !== "running" || current.containerId !== oldContainerId) {
      log.info("skipping recovery: session no longer expects this container", {
        sessionId: session.id,
        oldContainerId,
        nowStatus: current?.status,
        nowContainerId: current?.containerId,
      });
      return;
    }

    try {
      await stopAndRemoveContainer(oldContainerId, session.ttydPort).catch((err) => {
        log.warn("best-effort stale container cleanup failed", {
          sessionId: session.id,
          oldContainerId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      const project = await getProject(session.projectId);
      const { containerId, hostTtydPort } = await startSessionContainer({
        name: `rca-${session.id}`,
        hostProjectPath: project.path,
        agent: session.agent,
        resumeLatest: session.agent !== "shell",
        hostAgentHomePath: agentHomePathForSession(session),
      });
      await updateSessionsForContainer(session, oldContainerId, (current) => ({
        status: "running",
        containerId,
        ttydPort: hostTtydPort,
        lastError: undefined,
        agentState: current.agent === "shell" ? "idle" : "running",
        recoveryCount: (current.recoveryCount ?? 0) + 1,
        lastRecoveryAt: now,
        recoveryMessage: reason,
      }));
      log.warn("session container recovered", {
        sessionId: session.id,
        oldContainerId,
        newContainerId: containerId,
        reason,
      });
    } catch (err) {
      await updateSessionsForContainer(session, oldContainerId, () => ({
        status: "error",
        agentState: "stopped",
        lastError: `container exited and restart failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      }));
      log.error("failed to recover session container", {
        sessionId: session.id,
        oldContainerId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  recoveryInFlight.set(dedupeKey, recovery);
  try {
    await recovery;
  } finally {
    recoveryInFlight.delete(dedupeKey);
  }
  return getSession(session.id).catch(() => session);
}

async function recoverStoppedContainer(session: Session, exitCode?: number): Promise<Session> {
  return recoverSessionContainer(session, { exitCode });
}

async function syncOne(session: Session): Promise<Session> {
  if (!session.containerId) return session;

  try {
    const inspection = await inspectContainer(session.containerId);
    if (!inspection.State?.Running) {
      releasePort(session.ttydPort);
      return recoverStoppedContainer(session, inspection.State?.ExitCode);
    }

    if (!(await hasInteractiveRuntime(session.containerId))) {
      return recoverSessionContainer(session, {
        reason: "session terminal runtime stopped; restarted automatically",
      });
    }

    if (session.agent === "shell") {
      const patch: Partial<Session> = {
        status: "running",
        lastError: undefined,
        agentState: "idle",
      };
      if (!changed(session, patch)) return session;
      return updateSession(session.id, patch);
    }

    const runtime = await readRuntimeSnapshot(session.containerId);
    if (!runtime) return session;

    const patch: Partial<Session> = {
      status: "running",
      lastError: undefined,
      agentState: runtime.state,
      agentRestartCount: runtime.restartCount,
      agentLastExitCode: runtime.lastExitCode,
      agentLastExitAt: runtime.lastExitAt,
      agentLastCrashAt: runtime.lastCrashAt,
      agentCrashMessage: runtime.lastCrashReason,
    };
    if (!changed(session, patch)) return session;
    return updateSession(session.id, patch);
  } catch (err) {
    log.warn("failed to sync agent runtime", {
      sessionId: session.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return session;
  }
}

export async function syncProjectSessions(projectId: string): Promise<void> {
  const sessions = await listSessions(projectId);
  for (const session of sessions) {
    if (session.status === "running" && session.containerId) {
      // eslint-disable-next-line no-await-in-loop
      await syncOne(session);
    }
  }
}

export async function syncSessionRuntime(sessionId: string): Promise<Session> {
  const session = await getSession(sessionId);
  return syncOne(session);
}
