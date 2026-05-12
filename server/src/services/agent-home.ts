import path from "node:path";
import { config } from "../config.js";
import type { AgentKind, ContainerStrategy } from "../store/state.js";

export interface AgentHomeIdentity {
  id: string;
  projectId: string;
  agent: AgentKind;
  containerStrategy: ContainerStrategy;
}

export function agentHomePathForSession(session: AgentHomeIdentity): string {
  const key =
    session.containerStrategy === "per-project"
      ? `project-${session.projectId}-${session.agent}`
      : `session-${session.id}`;
  return path.join(config.dataRoot, "agent-homes", key);
}
