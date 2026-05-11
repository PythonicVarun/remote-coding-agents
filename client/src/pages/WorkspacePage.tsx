import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { Project, Session } from "@/lib/types";
import { FileTree } from "@/components/FileTree";
import { SessionsPanel } from "@/components/SessionsPanel";
import { TerminalFrame } from "@/components/TerminalFrame";
import { ChatPanel } from "@/components/ChatPanel";

export function WorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      <div className="grid flex-1 grid-cols-1 overflow-auto lg:grid-cols-[280px_minmax(0,1fr)_340px] lg:overflow-hidden">
        {/* Left: file tree + sessions */}
        <aside className="grid min-h-0 grid-rows-[minmax(220px,1fr)_minmax(220px,1fr)] border-b border-border-subtle bg-bg-subtle lg:flex lg:border-b-0 lg:border-r flex-col justify-between">
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

        {/* Center: ttyd terminal */}
        <section className="min-h-[380px] min-w-0 border-b border-border-subtle bg-bg lg:min-h-0 lg:border-b-0">
          <TerminalFrame projectId={projectId} sessionId={selectedSessionId} />
        </section>

        {/* Right: chat */}
        <aside className="min-h-[280px] bg-bg-subtle lg:min-h-0 lg:border-l lg:border-border-subtle">
          <ChatPanel
            projectId={projectId}
            sessionId={selectedSessionId}
            sessionTitle={selectedSession?.title}
          />
        </aside>
      </div>
    </div>
  );
}
