import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface ChatPanelProps {
  projectId: string;
  sessionId: string | null;
  sessionTitle?: string;
}

interface Entry {
  id: number;
  text: string;
  state: "sending" | "sent" | "error";
  error?: string;
}

let counter = 0;

export function ChatPanel({ projectId, sessionId, sessionTitle }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Reset transcript when session changes — these messages were for that session.
  useEffect(() => {
    setEntries([]);
  }, [sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const send = async () => {
    if (!sessionId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = ++counter;
    setEntries((prev) => [...prev, { id, text: trimmed, state: "sending" }]);
    setText("");
    try {
      await api.sendChat(projectId, sessionId, trimmed);
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, state: "sent" } : e)),
      );
    } catch (err) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, state: "error", error: err instanceof Error ? err.message : "send failed" }
            : e,
        ),
      );
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Chat</div>
        {sessionTitle ? (
          <div className="truncate text-xs text-fg-subtle">{sessionTitle}</div>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-3 py-3 text-xs"
      >
        {sessionId ? null : (
          <div className="text-fg-subtle">Select a session to send messages to its agent.</div>
        )}
        {sessionId && entries.length === 0 ? (
          <div className="text-fg-subtle">
            Messages here are injected as keystrokes into the agent's terminal.
            You can also type directly in the terminal pane.
          </div>
        ) : null}
        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className={cn(
                "rounded-md border px-3 py-2",
                e.state === "error"
                  ? "border-danger/30 bg-danger-subtle"
                  : "border-border-subtle bg-bg-elevated",
              )}
            >
              <pre className="whitespace-pre-wrap break-words font-sans text-fg">{e.text}</pre>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-fg-subtle">
                {e.state === "sending"
                  ? "sending..."
                  : e.state === "sent"
                  ? "sent"
                  : `error: ${e.error ?? ""}`}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <form
        onSubmit={onSubmit}
        className="border-t border-border-subtle p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={!sessionId}
            rows={2}
            placeholder={
              sessionId
                ? "Type a message to the agent. Enter to send, Shift+Enter for newline."
                : "Select a session first."
            }
            className={cn(
              "min-h-[64px] flex-1 resize-none rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm",
              "text-fg placeholder:text-fg-subtle",
              "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40",
              "disabled:opacity-50 transition-colors",
            )}
          />
          <Button type="submit" variant="primary" disabled={!sessionId || text.trim().length === 0}>
            <Send className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
