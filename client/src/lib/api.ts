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
  getSession: (projectId: string, sessionId: string) =>
    request<Session>(`/api/projects/${projectId}/sessions/${sessionId}`),
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

  // Uses XHR (not fetch) so the caller can observe upload progress via
  // xhr.upload.onprogress — fetch() exposes no equivalent in browsers today.
  uploadFile: (
    projectId: string,
    dir: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<{ path: string; size: number }> => {
    return new Promise((resolve, reject) => {
      const url =
        `/api/projects/${projectId}/fs/upload` +
        `?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader(
        "content-type",
        file.type || "application/octet-stream",
      );
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          // Some browsers report total=0 until the first packet — fall back to file.size.
          const total = e.lengthComputable && e.total > 0 ? e.total : file.size;
          onProgress(e.loaded, total);
        };
      }
      xhr.onload = () => {
        const text = xhr.responseText;
        let payload: unknown;
        try {
          payload = text ? JSON.parse(text) : undefined;
        } catch {
          payload = text;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(payload as { path: string; size: number });
        } else {
          const msg =
            payload && typeof payload === "object" && payload && "error" in payload
              ? String((payload as { error: unknown }).error)
              : xhr.statusText || `HTTP ${xhr.status}`;
          reject(new ApiError(xhr.status, msg, payload));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, "network error"));
      xhr.onabort = () => reject(new ApiError(0, "aborted"));
      xhr.send(file);
    });
  },

  downloadFileUrl: (projectId: string, path: string) =>
    `/api/projects/${projectId}/fs/download?path=${encodeURIComponent(path)}`,

  rawFileUrl: (projectId: string, path: string) =>
    `/api/projects/${projectId}/fs/raw?path=${encodeURIComponent(path)}`,

  mkdir: (projectId: string, dir: string, name: string) =>
    request<{ path: string }>(`/api/projects/${projectId}/fs/mkdir`, {
      method: "POST",
      body: JSON.stringify({ dir, name }),
    }),
};

export { ApiError };
