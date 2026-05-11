import { useEffect, useState } from "react";
import { Bot, Plus, Trash2, TerminalSquare } from "lucide-react";
import { api } from "@/lib/api";
import { AGENTS, type AgentKind, type ContainerStrategy, type Session } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";

interface SessionsPanelProps {
  projectId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SessionsPanel({ projectId, selectedId, onSelect }: SessionsPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    try {
      const list = await api.listSessions(projectId);
      setSessions(list);
      setError(null);
      if (!selectedId && list.length > 0 && list[0]) onSelect(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load sessions");
    }
  };

  useEffect(() => {
    void reload();
    const poll = window.setInterval(() => void reload(), 4000);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Stop and remove this session?")) return;
    try {
      await api.deleteSession(projectId, id);
      if (selectedId === id) onSelect("");
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Sessions</div>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" />
          New
        </Button>
      </div>
      {error ? (
        <div className="m-3 rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        {sessions.length === 0 ? (
          <div className="m-3 text-xs text-fg-subtle">
            No sessions yet. Create one to start an agent.
          </div>
        ) : (
          <ul className="space-y-px p-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left",
                    "transition-colors",
                    s.id === selectedId
                      ? "bg-accent-subtle text-fg"
                      : "hover:bg-bg-muted text-fg-muted",
                  )}
                >
                  <span className="mt-0.5">
                    {s.agent === "shell" ? (
                      <TerminalSquare className="h-4 w-4 text-fg-muted" />
                    ) : (
                      <Bot className="h-4 w-4 text-accent" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{s.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                      <Badge tone="neutral">{s.agent}</Badge>
                      <Badge tone="neutral">{s.containerStrategy}</Badge>
                    </span>
                    {s.lastError ? (
                      <span className="mt-1 block truncate text-[10px] text-danger">
                        {s.lastError}
                      </span>
                    ) : null}
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(s.id);
                    }}
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-elevated hover:text-danger group-hover:inline-flex"
                    aria-label="Delete session"
                    role="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CreateSessionDialog
        open={creating}
        projectId={projectId}
        onClose={() => setCreating(false)}
        onCreated={(s) => {
          setCreating(false);
          onSelect(s.id);
          void reload();
        }}
      />
    </div>
  );
}

function statusTone(s: Session["status"]) {
  switch (s) {
    case "running":
      return "success" as const;
    case "creating":
      return "warning" as const;
    case "error":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

interface CreateSessionDialogProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (s: Session) => void;
}

function CreateSessionDialog({ open, projectId, onClose, onCreated }: CreateSessionDialogProps) {
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState<AgentKind>("claude");
  const [strategy, setStrategy] = useState<ContainerStrategy>("per-session");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setAgent("claude");
      setStrategy("per-session");
      setError(null);
    }
  }, [open]);

  const agentMeta = AGENTS.find((a) => a.kind === agent);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const fallbackTitle = agentMeta ? `${agentMeta.label} session` : "Session";
      const s = await api.createSession(projectId, {
        title: title.trim() || fallbackTitle,
        agent,
        containerStrategy: strategy,
      });
      onCreated(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      description="Each session runs in its own Docker container with the project bind-mounted at /workspace."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Starting..." : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Title</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. fix flaky auth test"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Agent</span>
          <Select value={agent} onChange={(e) => setAgent(e.target.value as AgentKind)}>
            {AGENTS.map((a) => (
              <option key={a.kind} value={a.kind}>
                {a.label}
              </option>
            ))}
          </Select>
          {agentMeta ? (
            <span className="mt-1 block text-[11px] text-fg-subtle">{agentMeta.description}</span>
          ) : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Container</span>
          <Select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as ContainerStrategy)}
          >
            <option value="per-session">New container for this session</option>
            <option value="per-project">Attach to existing project container</option>
          </Select>
        </label>
        {error ? (
          <div className="rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
