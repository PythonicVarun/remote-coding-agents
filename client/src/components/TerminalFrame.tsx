import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";

interface TerminalFrameProps {
  projectId: string;
  sessionId: string | null;
}

export function TerminalFrame({ projectId, sessionId }: TerminalFrameProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the session record briefly until it transitions to running.
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const list = await api.listSessions(projectId);
        const s = list.find((x) => x.id === sessionId) ?? null;
        if (stopped) return;
        setSession(s);
        setError(null);
        if (s && s.status === "creating") {
          timer = window.setTimeout(tick, 800);
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "failed to load session");
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [projectId, sessionId]);

  if (!sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-subtle">
        <div className="text-sm">Select a session to open its terminal.</div>
        <Badge tone="neutral">no session</Badge>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded border border-danger/30 bg-danger-subtle p-3 text-xs text-danger">
        {error}
      </div>
    );
  }

  if (!session || session.status === "creating") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Starting container...
      </div>
    );
  }

  if (session.status !== "running") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Badge tone="danger">{session.status}</Badge>
        {session.lastError ? (
          <pre className="max-w-xl whitespace-pre-wrap text-xs text-danger">{session.lastError}</pre>
        ) : null}
      </div>
    );
  }

  // ttyd is being reverse-proxied at /ttyd/<sessionId>/...
  const src = `/ttyd/${session.id}/`;
  return (
    <iframe
      key={session.id}
      src={src}
      title={`Terminal for ${session.title}`}
      className="h-full w-full border-0 bg-black"
      sandbox="allow-same-origin allow-scripts allow-forms allow-clipboard-read allow-clipboard-write"
    />
  );
}
