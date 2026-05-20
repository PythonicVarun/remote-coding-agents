// Mirrors the shapes returned by the backend. Keep in sync with server/src/store/state.ts.

export type AgentKind = "claude" | "codex" | "gemini" | "copilot" | "shell";
export type AgentState = "idle" | "running" | "restarting" | "stopped";

export interface AgentMeta {
  kind: AgentKind;
  label: string;
  description: string;
}

export const AGENTS: AgentMeta[] = [
  {
    kind: "claude",
    label: "Claude Code (YOLO)",
    description: "Anthropic · runs with --dangerously-skip-permissions (disabled for root/sudo). Needs ANTHROPIC_API_KEY.",
  },
  {
    kind: "codex",
    label: "Codex (YOLO)",
    description: "OpenAI · runs with --yolo. Needs OPENAI_API_KEY.",
  },
  {
    kind: "gemini",
    label: "Gemini CLI (YOLO)",
    description: "Google · runs with --yolo. Needs GEMINI_API_KEY or GOOGLE_API_KEY.",
  },
  {
    kind: "copilot",
    label: "GitHub Copilot CLI (YOLO)",
    description: "GitHub · runs with --yolo. Needs GITHUB_TOKEN.",
  },
  {
    kind: "shell",
    label: "Bare shell",
    description: "No agent — just bash. Install whatever CLI you want at session start.",
  },
];

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
  agentState?: AgentState;
  agentRestartCount?: number;
  agentLastExitCode?: number;
  agentLastExitAt?: string;
  agentLastCrashAt?: string;
  agentCrashMessage?: string;
  recoveryCount?: number;
  lastRecoveryAt?: string;
  recoveryMessage?: string;
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