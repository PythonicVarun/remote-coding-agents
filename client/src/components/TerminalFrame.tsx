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

  // Keep the selected session fresh. This lets the iframe reconnect when a
  // crashed container is recovered with a new container id / ttyd port.
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const s = await api.getSession(projectId, sessionId);
        if (stopped) return;
        setSession(s);
        setError(null);
        timer = window.setTimeout(tick, s.status === "creating" ? 800 : 2500);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "failed to load session");
        timer = window.setTimeout(tick, 2500);
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
  const iframeKey = [
    session.id,
    session.containerId ?? "",
    session.ttydPort ?? "",
    session.recoveryCount ?? 0,
  ].join(":");
  return (
    <iframe
      key={iframeKey}
      src={src}
      title={`Terminal for ${session.title}`}
      className="h-full w-full border-0 bg-bg"
      sandbox="allow-same-origin allow-scripts allow-forms allow-clipboard-read allow-clipboard-write"
    />
  );
}
