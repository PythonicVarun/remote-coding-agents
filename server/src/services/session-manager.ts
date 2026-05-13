// Glues store + docker + ports together for session lifecycle.

import { getProject } from "../store/projects.js";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "../store/sessions.js";
import { AGENT_KINDS, type AgentKind, type ContainerStrategy, type Session } from "../store/state.js";
import {
  ensureAgentImage,
  startSessionContainer,
  stopAndRemoveContainer,
} from "./docker.js";
import { agentHomePathForSession } from "./agent-home.js";
import { ensureProjectTreeWritable } from "./project-permissions.js";
import { sendChatToSession } from "./chat.js";
import { logger } from "../lib/logger.js";
import { badRequest } from "../lib/errors.js";

const log = logger("session-manager");

export interface CreateSessionInput {
  projectId: string;
  title: string;
  agent: AgentKind;
  containerStrategy: ContainerStrategy;
  initialPrompt?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverInitialPrompt(containerId: string, text: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await sendChatToSession(containerId, text);
      return;
    } catch (err) {
      lastError = err;
      await sleep(500);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function createAndStartSession(input: CreateSessionInput): Promise<Session> {
  if (!AGENT_KINDS.includes(input.agent)) {
    throw badRequest(`agent must be one of ${AGENT_KINDS.join(", ")}`);
  }
  if (!["per-session", "per-project"].includes(input.containerStrategy)) {
    throw badRequest("containerStrategy must be 'per-session' or 'per-project'");
  }
  const initialPrompt = input.initialPrompt?.trim();
  if (initialPrompt && initialPrompt.length > 8000) {
    throw badRequest("initialPrompt must be 8000 chars or fewer");
  }

  const project = await getProject(input.projectId);
  await ensureProjectTreeWritable(project.path);
  await ensureAgentImage();

  // If per-project, see if another session for this project already has a
  // running container with the same agent kind. We piggyback if so.
  if (input.containerStrategy === "per-project") {
    const existing = (await listSessions(project.id)).find(
      (s) =>
        s.containerStrategy === "per-project" &&
        s.agent === input.agent &&
        s.status === "running" &&
        s.containerId &&
        s.ttydPort,
    );
    if (existing) {
      const session = await createSession(input);
      let attached = await updateSession(session.id, {
        status: "running",
        containerId: existing.containerId!,
        ttydPort: existing.ttydPort!,
        lastError: undefined,
      });
      if (initialPrompt) {
        try {
          await deliverInitialPrompt(existing.containerId!, initialPrompt);
        } catch (err) {
          attached = await updateSession(session.id, {
            lastError: `session started, but initial task failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          });
          log.warn("failed to deliver initial prompt to shared container", {
            sessionId: session.id,
            containerId: existing.containerId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      log.info("attached to existing per-project container", {
        sessionId: session.id,
        containerId: existing.containerId,
      });
      return attached;
    }
  }

  const session = await createSession(input);
  try {
    const containerName = `rca-${session.id}`;
    const { containerId, hostTtydPort } = await startSessionContainer({
      name: containerName,
      hostProjectPath: project.path,
      agent: input.agent,
      initialCmd: initialPrompt,
      hostAgentHomePath: agentHomePathForSession(session),
    });
    let running = await updateSession(session.id, {
      status: "running",
      containerId,
      ttydPort: hostTtydPort,
      lastError: undefined,
    });
    log.info("session started", { sessionId: session.id, containerId, hostTtydPort });
    return running;
  } catch (err) {
    const failed = await getSession(session.id).catch(() => null);
    if (failed?.containerId) {
      await stopAndRemoveContainer(failed.containerId, failed.ttydPort).catch(() => undefined);
    }
    await updateSession(session.id, {
      status: "error",
      lastError: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function stopAndDeleteSession(sessionId: string): Promise<void> {
  const session = await getSession(sessionId);

  // Per-project containers are shared: only tear down when the last session
  // using this container is being deleted.
  let shouldStopContainer = true;
  if (session.containerStrategy === "per-project" && session.containerId) {
    const peers = await listSessions(session.projectId);
    const stillUsing = peers.filter(
      (s) => s.id !== session.id && s.containerId === session.containerId,
    );
    if (stillUsing.length > 0) shouldStopContainer = false;
  }

  if (session.containerId && shouldStopContainer) {
    await stopAndRemoveContainer(session.containerId, session.ttydPort);
  }

  await deleteSession(session.id);
  log.info("session removed", { sessionId, stoppedContainer: shouldStopContainer });
}
