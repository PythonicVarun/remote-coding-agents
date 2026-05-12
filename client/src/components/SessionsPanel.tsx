import { useEffect, useRef, useState } from "react";
import { Bot, Plus, Trash2, TerminalSquare } from "lucide-react";
import { api } from "@/lib/api";
import { AGENTS, type AgentKind, type ContainerStrategy, type Session } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";

interface SessionsPanelProps {
  projectId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface CrashNotice {
  kind: "agent" | "container";
  sessionTitle: string;
  message: string;
  restartedAt?: string;
}

export function SessionsPanel({ projectId, selectedId, onSelect }: SessionsPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [crashNotice, setCrashNotice] = useState<CrashNotice | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const seenRestartCounts = useRef<Map<string, number>>(new Map());
  const seenRecoveryCounts = useRef<Map<string, number>>(new Map());
  const isFirstLoad = useRef(true);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const reload = async () => {
    try {
      const list = await api.listSessions(projectId);
      setSessions(list);
      setError(null);
      if (isFirstLoad.current) {
        seenRestartCounts.current = new Map(list.map((s) => [s.id, s.agentRestartCount ?? 0]));
        seenRecoveryCounts.current = new Map(list.map((s) => [s.id, s.recoveryCount ?? 0]));
        isFirstLoad.current = false;
      } else {
        let nextRecoveryNotice: CrashNotice | null = null;
        let nextAgentNotice: CrashNotice | null = null;
        for (const session of list) {
          const previousRecovery = seenRecoveryCounts.current.get(session.id) ?? 0;
          const currentRecovery = session.recoveryCount ?? 0;
          if (currentRecovery > previousRecovery && !nextRecoveryNotice) {
            nextRecoveryNotice = {
              kind: "container",
              sessionTitle: session.title,
              message:
                session.recoveryMessage ??
                "The session container stopped unexpectedly and was restarted automatically.",
              restartedAt: session.lastRecoveryAt,
            };
          }
          const previous = seenRestartCounts.current.get(session.id) ?? 0;
          const current = session.agentRestartCount ?? 0;
          if (current > previous && session.agent !== "shell" && !nextAgentNotice) {
            nextAgentNotice = {
              kind: "agent",
              sessionTitle: session.title,
              message:
                session.agentCrashMessage ??
                "The agent exited and was automatically resumed in the latest conversation.",
              restartedAt: session.agentLastCrashAt,
            };
          }
        }
        const nextNotice = nextRecoveryNotice ?? nextAgentNotice;
        if (nextNotice) {
          setCrashNotice(nextNotice);
        }
        seenRestartCounts.current = new Map(list.map((s) => [s.id, s.agentRestartCount ?? 0]));
        seenRecoveryCounts.current = new Map(list.map((s) => [s.id, s.recoveryCount ?? 0]));
      }
      if (!selectedIdRef.current && list.length > 0 && list[0]) onSelect(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load sessions");
    }
  };

  useEffect(() => {
    isFirstLoad.current = true;
    seenRestartCounts.current = new Map();
    seenRecoveryCounts.current = new Map();
    setCrashNotice(null);
    void reload();
    const poll = window.setInterval(() => void reload(), 4000);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const requestDelete = (session: Session) => setPendingDelete(session);

  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setDeleting(true);
    try {
      await api.deleteSession(projectId, target.id);
      if (selectedId === target.id) onSelect("");
      void reload();
      setPendingDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    } finally {
      setDeleting(false);
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
                      {typeof s.agentRestartCount === "number" && s.agentRestartCount > 0 ? (
                        <Badge tone="warning">resumed {s.agentRestartCount}</Badge>
                      ) : null}
                      {typeof s.recoveryCount === "number" && s.recoveryCount > 0 ? (
                        <Badge tone="warning">recovered {s.recoveryCount}</Badge>
                      ) : null}
                      {s.agentState === "restarting" ? (
                        <Badge tone="warning">restarting</Badge>
                      ) : null}
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
                      requestDelete(s);
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
      <Dialog
        open={Boolean(crashNotice)}
        onClose={() => setCrashNotice(null)}
        title={crashNotice?.kind === "container" ? "Container Restarted" : "Agent Restarted"}
        description={
          crashNotice?.kind === "container"
            ? "The session container stopped unexpectedly and was restarted automatically."
            : "The running agent exited or crashed and was resumed automatically."
        }
        footer={
          <Button variant="primary" onClick={() => setCrashNotice(null)}>
            Dismiss
          </Button>
        }
      >
        <div className="space-y-3 text-sm text-fg-muted">
          <p>
            <span className="font-medium text-fg">{crashNotice?.sessionTitle}</span>
            {" "}was restarted automatically.
          </p>
          <div className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
            {crashNotice?.message}
          </div>
          {crashNotice?.restartedAt ? (
            <p className="text-xs text-fg-subtle">
              Restart detected at {new Date(crashNotice.restartedAt).toLocaleString()}.
            </p>
          ) : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Stop and remove session?"
        description="The container is stopped and the session record is deleted."
        message={
          pendingDelete
            ? `“${pendingDelete.title}” will be stopped and removed.`
            : ""
        }
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => (deleting ? undefined : setPendingDelete(null))}
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
  const [initialPrompt, setInitialPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setAgent("claude");
      setStrategy("per-session");
      setInitialPrompt("");
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
        initialPrompt: initialPrompt.trim() || undefined,
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
      description="Start an agent container, optionally seed it with an initial task, and watch the terminal live."
      width="lg"
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
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-muted">Initial task</span>
          <textarea
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="Optional. Example: Scaffold a FastAPI service with health and metrics endpoints."
            className={cn(
              "w-full resize-y rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm",
              "text-fg placeholder:text-fg-subtle",
              "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
              "disabled:opacity-50 transition-colors",
            )}
          />
          <span className="mt-1 block text-[11px] text-fg-subtle">
            If provided, the message is injected into the agent terminal automatically after the session starts.
          </span>
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