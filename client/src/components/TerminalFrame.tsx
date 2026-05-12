import { useCallback, useEffect, useRef, useState } from "react";
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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

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

  // Push our themed scrollbar CSS into the ttyd iframe so it matches the host.
  // The iframe is same-origin (proxied through the backend), so we can reach
  // contentDocument despite the sandbox attribute (allow-same-origin is set).
  const injectScrollbarStyles = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let doc: Document | null;
    try {
      doc = iframe.contentDocument;
    } catch {
      return;
    }
    if (!doc || !doc.head) return;

    const css = getComputedStyle(document.documentElement);
    const thumb = css.getPropertyValue("--scrollbar-thumb").trim() || "rgb(64 83 95 / 0.55)";
    const thumbHover =
      css.getPropertyValue("--scrollbar-thumb-hover").trim() || "rgb(47 124 246 / 0.55)";
    const thumbActive =
      css.getPropertyValue("--scrollbar-thumb-active").trim() || "rgb(47 124 246 / 0.85)";

    let style = doc.getElementById("rca-scrollbar-style") as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = "rca-scrollbar-style";
      doc.head.appendChild(style);
    }
    style.textContent = `
      html { scrollbar-color: ${thumb} transparent; scrollbar-width: thin; }
      *::-webkit-scrollbar { width: 10px; height: 10px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb {
        background-color: ${thumb};
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
        transition: background-color 0.15s ease;
      }
      *::-webkit-scrollbar-thumb:hover {
        background-color: ${thumbHover};
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-thumb:active {
        background-color: ${thumbActive};
        background-clip: padding-box;
      }
      *::-webkit-scrollbar-corner { background: transparent; }
    `;
  }, []);

  // Re-apply scrollbar styles whenever the host theme attribute flips.
  useEffect(() => {
    const observer = new MutationObserver(() => injectScrollbarStyles());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [injectScrollbarStyles]);

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
      ref={iframeRef}
      key={iframeKey}
      src={src}
      title={`Terminal for ${session.title}`}
      className="h-full w-full border-0 bg-bg"
      sandbox="allow-same-origin allow-scripts allow-forms allow-clipboard-read allow-clipboard-write"
      onLoad={injectScrollbarStyles}
    />
  );
}
