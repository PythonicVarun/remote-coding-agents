import type {
  AgentKind,
  ContainerStrategy,
  FsNode,
  Project,
  Session,
} from "./types";

class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  let payload: unknown;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const msg =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(res.status, msg, payload);
  }
  return payload as T;
}

export const api = {
  health: () => request<{ ok: boolean; time: string }>(`/api/health`),

  listProjects: () => request<Project[]>(`/api/projects`),
  createProject: (name: string) =>
    request<Project>(`/api/projects`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  deleteProject: (id: string, removeFiles: boolean) =>
    request<void>(`/api/projects/${id}?removeFiles=${removeFiles}`, {
      method: "DELETE",
    }),

  listSessions: (projectId: string) =>
    request<Session[]>(`/api/projects/${projectId}/sessions`),
  createSession: (
    projectId: string,
    body: {
      title: string;
      agent: AgentKind;
      containerStrategy: ContainerStrategy;
      initialPrompt?: string;
    },
  ) =>
    request<Session>(`/api/projects/${projectId}/sessions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteSession: (projectId: string, sessionId: string) =>
    request<void>(`/api/projects/${projectId}/sessions/${sessionId}`, {
      method: "DELETE",
    }),
  sendChat: (projectId: string, sessionId: string, text: string) =>
    request<{ ok: true }>(`/api/projects/${projectId}/sessions/${sessionId}/chat`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  getTree: (projectId: string) =>
    request<FsNode>(`/api/projects/${projectId}/fs/tree`),
  readFile: (projectId: string, path: string) =>
    request<{ content: string; truncated: boolean; size: number }>(
      `/api/projects/${projectId}/fs/file?path=${encodeURIComponent(path)}`,
    ),

  uploadFile: async (
    projectId: string,
    dir: string,
    file: File,
  ): Promise<{ path: string; size: number }> => {
    const url =
      `/api/projects/${projectId}/fs/upload` +
      `?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = text;
    }
    if (!res.ok) {
      const msg =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error: unknown }).error)
          : res.statusText;
      throw new ApiError(res.status, msg, payload);
    }
    return payload as { path: string; size: number };
  },

  downloadFileUrl: (projectId: string, path: string) =>
    `/api/projects/${projectId}/fs/download?path=${encodeURIComponent(path)}`,
};

export { ApiError };
