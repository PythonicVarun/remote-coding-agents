// Glues store + docker + ports together for session lifecycle.

import { getProject } from "../store/projects.js";
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  updateSession,
} from "../store/sessions.js";
import type { AgentKind, ContainerStrategy, Session } from "../store/state.js";
import {
  ensureAgentImage,
  startSessionContainer,
  stopAndRemoveContainer,
} from "./docker.js";
import { logger } from "../lib/logger.js";
import { badRequest } from "../lib/errors.js";

const log = logger("session-manager");

export interface CreateSessionInput {
  projectId: string;
  title: string;
  agent: AgentKind;
  containerStrategy: ContainerStrategy;
}

export async function createAndStartSession(input: CreateSessionInput): Promise<Session> {
  if (!["claude", "shell"].includes(input.agent)) {
    throw badRequest("agent must be 'claude' or 'shell'");
  }
  if (!["per-session", "per-project"].includes(input.containerStrategy)) {
    throw badRequest("containerStrategy must be 'per-session' or 'per-project'");
  }

  const project = await getProject(input.projectId);
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
      const attached = await updateSession(session.id, {
        status: "running",
        containerId: existing.containerId!,
        ttydPort: existing.ttydPort!,
      });
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
    });
    const running = await updateSession(session.id, {
      status: "running",
      containerId,
      ttydPort: hostTtydPort,
    });
    log.info("session started", { sessionId: session.id, containerId, hostTtydPort });
    return running;
  } catch (err) {
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
