import { nanoid } from "nanoid";
import { notFound } from "../lib/errors.js";
import { mutate, readState, type Session, type AgentKind, type ContainerStrategy } from "./state.js";

export async function listSessions(projectId: string): Promise<Session[]> {
  const s = await readState();
  return s.sessions
    .filter((x) => x.projectId === projectId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSession(id: string): Promise<Session> {
  const s = await readState();
  const found = s.sessions.find((x) => x.id === id);
  if (!found) throw notFound(`session ${id} not found`);
  return found;
}

export async function createSession(input: {
  projectId: string;
  title: string;
  agent: AgentKind;
  containerStrategy: ContainerStrategy;
}): Promise<Session> {
  return mutate(async (state) => {
    const now = new Date().toISOString();
    const session: Session = {
      id: nanoid(12),
      projectId: input.projectId,
      title: input.title.trim() || "Untitled session",
      agent: input.agent,
      containerStrategy: input.containerStrategy,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    };
    state.sessions.push(session);
    return session;
  });
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<Session, "id" | "projectId" | "createdAt">>,
): Promise<Session> {
  return mutate(async (state) => {
    const idx = state.sessions.findIndex((s) => s.id === id);
    if (idx === -1) throw notFound(`session ${id} not found`);
    const current = state.sessions[idx]!;
    const updated: Session = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    state.sessions[idx] = updated;
    return updated;
  });
}

export async function deleteSession(id: string): Promise<void> {
  await mutate(async (state) => {
    state.sessions = state.sessions.filter((s) => s.id !== id);
  });
}
