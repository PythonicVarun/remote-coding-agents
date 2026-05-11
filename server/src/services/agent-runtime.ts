import { inspectContainer, execInContainer } from "./docker.js";
import { releasePort } from "./ports.js";
import { getSession, listSessions, updateSession } from "../store/sessions.js";
import { logger } from "../lib/logger.js";
import type { AgentState, Session } from "../store/state.js";

const log = logger("agent-runtime");
const STATUS_FILE = "/tmp/rca-agent-status.json";

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

async function syncOne(session: Session): Promise<Session> {
  if (!session.containerId) return session;

  try {
    const inspection = await inspectContainer(session.containerId);
    if (!inspection.State?.Running) {
      releasePort(session.ttydPort);
      const patch: Partial<Session> = {
        status: "error",
        agentState: "stopped",
        lastError: `container exited${
          typeof inspection.State?.ExitCode === "number" ? ` (code ${inspection.State.ExitCode})` : ""
        }`,
      };
      if (!changed(session, patch)) return session;
      return updateSession(session.id, patch);
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
