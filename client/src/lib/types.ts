// Mirrors the shapes returned by the backend. Keep in sync with server/src/store/state.ts.

export type AgentKind = "claude" | "shell";
export type ContainerStrategy = "per-session" | "per-project";
export type SessionStatus = "creating" | "running" | "stopped" | "error";

export interface Project {
  id: string;
  name: string;
  slug: string;
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
  containerId?: string;
  ttydPort?: number;
  status: SessionStatus;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FsNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FsNode[];
}

export type FsEventKind = "add" | "addDir" | "change" | "unlink" | "unlinkDir";

export interface FsEvent {
  projectId: string;
  kind: FsEventKind;
  path: string;
  size?: number;
  modified?: string;
}
