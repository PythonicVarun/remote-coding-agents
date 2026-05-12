import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { FileTree } from "@/components/FileTree";
import { SessionsPanel } from "@/components/SessionsPanel";
import { TerminalFrame } from "@/components/TerminalFrame";
// Chat panel temporarily disabled — see also the commented JSX below.
// import { ChatPanel } from "@/components/ChatPanel";
import { Resizer } from "@/components/ui/Resizer";

const LS = {
  left: "rca:workspace:leftW",
  leftTop: "rca:workspace:leftTopH",
} as const;

const DEFAULTS = { left: 300, leftTop: 320 };

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
  const [error, setError] = useState<string | null>(null);

  // Resizable panel sizes. Persisted to localStorage.
  const [leftW, setLeftW] = useState(() => readNum(LS.left, DEFAULTS.left));
  const [leftTopH, setLeftTopH] = useState(() => readNum(LS.leftTop, DEFAULTS.leftTop));
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    window.localStorage.setItem(LS.left, String(Math.round(leftW)));
  }, [leftW]);
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

  if (!projectId) return null;

  // Build the desktop grid template from the live sizes. The Resizer is a 6px
  // column itself so the math stays explicit. The chat column is disabled.
  const desktopTemplate = `${leftW}px 6px minmax(0,1fr)`;

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

          {/*
            Right: chat panel — disabled for now. To restore, re-add:
              const [rightW, setRightW] = useState(() => readNum("rca:workspace:rightW", 360));
              const [selectedSession, setSelectedSession] = useState<Session | null>(null);
              (plus the previous polling effect)
            then put the columns back at the end of the grid template:
              `${leftW}px 6px minmax(0,1fr) 6px ${rightW}px`
            and re-render <Resizer axis="x" invert ... /> followed by
              <aside className="min-w-0 bg-bg-subtle">
                <ChatPanel projectId={projectId} sessionId={selectedSessionId} sessionTitle={selectedSession?.title} />
              </aside>
          */}
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

          {/* Chat panel disabled. See the desktop branch comment for restoration steps. */}
        </div>
      )}
    </div>
  );
}
