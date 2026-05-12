import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { Project, Session } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { FileTree } from "@/components/FileTree";
import { SessionsPanel } from "@/components/SessionsPanel";
import { TerminalFrame } from "@/components/TerminalFrame";
import { ChatPanel } from "@/components/ChatPanel";
import { Resizer } from "@/components/ui/Resizer";

const LS = {
  left: "rca:workspace:leftW",
  right: "rca:workspace:rightW",
  leftTop: "rca:workspace:leftTopH",
} as const;

const DEFAULTS = { left: 300, right: 360, leftTop: 320 };

function readNum(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resizable panel sizes. Persisted to localStorage.
  const [leftW, setLeftW] = useState(() => readNum(LS.left, DEFAULTS.left));
  const [rightW, setRightW] = useState(() => readNum(LS.right, DEFAULTS.right));
  const [leftTopH, setLeftTopH] = useState(() => readNum(LS.leftTop, DEFAULTS.leftTop));
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    window.localStorage.setItem(LS.left, String(Math.round(leftW)));
  }, [leftW]);
  useEffect(() => {
    window.localStorage.setItem(LS.right, String(Math.round(rightW)));
  }, [rightW]);
  useEffect(() => {
    window.localStorage.setItem(LS.leftTop, String(Math.round(leftTopH)));
  }, [leftTopH]);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        setProject(await api.getProject(projectId));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to load project");
      }
    })();
  }, [projectId]);

  // Keep selectedSession (object) in sync with selectedSessionId.
  useEffect(() => {
    if (!projectId || !selectedSessionId) {
      setSelectedSession(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const list = await api.listSessions(projectId);
        if (stopped) return;
        setSelectedSession(list.find((s) => s.id === selectedSessionId) ?? null);
        timer = window.setTimeout(tick, 4000);
      } catch {
        if (!stopped) {
          timer = window.setTimeout(tick, 4000);
        }
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [projectId, selectedSessionId]);

  if (!projectId) return null;

  // Build the desktop grid template from the live sizes. Resizers are 6px
  // columns themselves so the math stays explicit.
  const desktopTemplate = `${leftW}px 6px minmax(0,1fr) 6px ${rightW}px`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border-subtle bg-bg-subtle px-4 py-2">
        <Link
          to="/"
          className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Projects
        </Link>
        <div className="text-fg-subtle">/</div>
        <div className="truncate text-sm font-semibold">{project?.name ?? projectId}</div>
        <div className="ml-2 truncate text-xs text-fg-subtle">{project?.path}</div>
      </header>

      {error ? (
        <div className="m-4 rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {isDesktop ? (
        <div
          className="grid flex-1 overflow-hidden"
          style={{ gridTemplateColumns: desktopTemplate }}
        >
          {/* Left column: file tree above sessions, separated by a horizontal resizer. */}
          <aside
            className="grid min-h-0 bg-bg-subtle"
            style={{ gridTemplateRows: `${leftTopH}px 6px minmax(0,1fr)` }}
          >
            <div className="min-h-0 overflow-hidden">
              <FileTree projectId={projectId} />
            </div>
            <Resizer
              axis="y"
              value={leftTopH}
              onChange={setLeftTopH}
              min={140}
              max={900}
              ariaLabel="Resize files vs sessions"
            />
            <div className="min-h-0 overflow-hidden">
              <SessionsPanel
                projectId={projectId}
                selectedId={selectedSessionId}
                onSelect={(id) => setSelectedSessionId(id || null)}
              />
            </div>
          </aside>

          <Resizer
            axis="x"
            value={leftW}
            onChange={setLeftW}
            min={200}
            max={640}
            ariaLabel="Resize files panel"
          />

          {/* Center: ttyd terminal */}
          <section className="min-w-0 bg-bg">
            <TerminalFrame projectId={projectId} sessionId={selectedSessionId} />
          </section>

          <Resizer
            axis="x"
            value={rightW}
            onChange={setRightW}
            invert
            min={240}
            max={720}
            ariaLabel="Resize chat panel"
          />

          {/* Right: chat */}
          <aside className="min-w-0 bg-bg-subtle">
            <ChatPanel
              projectId={projectId}
              sessionId={selectedSessionId}
              sessionTitle={selectedSession?.title}
            />
          </aside>
        </div>
      ) : (
        // Mobile / narrow: stacked layout. Resize handles disabled on touch.
        <div className="flex flex-1 flex-col overflow-auto">
          <aside className="grid min-h-0 grid-rows-[minmax(220px,1fr)_minmax(220px,1fr)] border-b border-border-subtle bg-bg-subtle">
            <div className="min-h-0 overflow-hidden border-b border-border-subtle">
              <FileTree projectId={projectId} />
            </div>
            <div className="min-h-0 overflow-hidden">
              <SessionsPanel
                projectId={projectId}
                selectedId={selectedSessionId}
                onSelect={(id) => setSelectedSessionId(id || null)}
              />
            </div>
          </aside>

          <section className="min-h-[380px] min-w-0 border-b border-border-subtle bg-bg">
            <TerminalFrame projectId={projectId} sessionId={selectedSessionId} />
          </section>

          <aside className="min-h-[280px] bg-bg-subtle">
            <ChatPanel
              projectId={projectId}
              sessionId={selectedSessionId}
              sessionTitle={selectedSession?.title}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
