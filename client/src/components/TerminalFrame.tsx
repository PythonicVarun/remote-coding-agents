import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { useTheme } from "@/lib/useTheme";

interface TerminalFrameProps {
  projectId: string;
  sessionId: string | null;
}

const darkTheme = {
  background: "#0b1114",
  foreground: "#e8eef2",
  cursor: "#2f7cf6",
  cursorAccent: "#0b1114",
  selectionBackground: "#12233f",
  selectionForeground: "#f7fafc",
  black: "#10181d",
  red: "#f36d6d",
  green: "#31c48d",
  yellow: "#f2b84b",
  blue: "#2f7cf6",
  magenta: "#b58bf6",
  cyan: "#5cbfb8",
  white: "#a5b2bc",
  brightBlack: "#40535f",
  brightRed: "#ff8b8b",
  brightGreen: "#5ed3a8",
  brightYellow: "#ffc966",
  brightBlue: "#5a98f7",
  brightMagenta: "#d5acff",
  brightCyan: "#7fd9d2",
  brightWhite: "#e8eef2",
};

const lightTheme = {
  background: "#f6f8fa",
  foreground: "#0b1114",
  cursor: "#2f7cf6",
  cursorAccent: "#f6f8fa",
  selectionBackground: "#e3edff",
  selectionForeground: "#0b1114",
  black: "#d6dce2",
  red: "#c43030",
  green: "#1f9d6a",
  yellow: "#b67200",
  blue: "#2f7cf6",
  magenta: "#9b59b6",
  cyan: "#3498db",
  white: "#6b7785",
  brightBlack: "#afbac4",
  brightRed: "#e74c3c",
  brightGreen: "#2ecc71",
  brightYellow: "#f1c40f",
  brightBlue: "#3498db",
  brightMagenta: "#9b59b6",
  brightCyan: "#1abc9c",
  brightWhite: "#0b1114",
};

export function TerminalFrame({ projectId, sessionId }: TerminalFrameProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [theme] = useTheme();

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
  const currentTheme = theme === "dark" ? darkTheme : lightTheme;
  const ttydThemeObj = encodeURIComponent(JSON.stringify(currentTheme));
  const src = `/ttyd/${session.id}/?theme=${ttydThemeObj}`;
  const iframeKey = [
    session.id,
    session.containerId ?? "",
    session.ttydPort ?? "",
    session.recoveryCount ?? 0,
    theme,
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

