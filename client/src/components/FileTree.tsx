import { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronRight, File as FileIcon, Folder, FolderOpen, RotateCw } from "lucide-react";
import { api } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import type { FsEvent, FsNode } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

interface FileTreeProps {
  projectId: string;
}

export function FileTree({ projectId }: FileTreeProps) {
  const [root, setRoot] = useState<FsNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [refreshing, setRefreshing] = useState(false);
  const [flash, setFlash] = useState<Map<string, number>>(new Map());

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const tree = await api.getTree(projectId);
      setRoot(tree);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load tree");
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates via Socket.IO. We refresh the tree on FS events (debounced).
  useEffect(() => {
    const socket = getSocket();
    let debounce: number | undefined;
    const flashTimers: number[] = [];

    const subscribe = () =>
      new Promise<void>((resolve, reject) => {
        socket.emit("project:subscribe", projectId, (err?: string) => {
          if (err) reject(new Error(err));
          else resolve();
        });
      });

    void subscribe().catch((err) => setError(err.message));
    if (!socket.connected) {
      socket.once("connect", () => void subscribe());
    }

    const onEvent = (ev: FsEvent) => {
      if (ev.projectId !== projectId) return;
      // Flash the changed path so the user sees it.
      setFlash((prev) => {
        const next = new Map(prev);
        next.set(ev.path, Date.now());
        return next;
      });
      const t = window.setTimeout(() => {
        setFlash((prev) => {
          const next = new Map(prev);
          next.delete(ev.path);
          return next;
        });
      }, 1200);
      flashTimers.push(t);

      // Debounce full-tree refreshes (many writes during a build).
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        void refresh();
      }, 250);
    };

    socket.on("fs:event", onEvent);
    return () => {
      socket.off("fs:event", onEvent);
      socket.emit("project:unsubscribe", projectId);
      if (debounce) window.clearTimeout(debounce);
      flashTimers.forEach((t) => window.clearTimeout(t));
    };
  }, [projectId, refresh]);

  const flattened = useMemo(() => (root ? flatten(root, expanded) : []), [root, expanded]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Files</div>
        <Button size="sm" variant="ghost" onClick={() => void refresh()} aria-label="Refresh tree">
          <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>
      <div className="flex-1 overflow-auto py-1 font-mono text-xs">
        {error ? (
          <div className="m-3 rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-danger">
            {error}
          </div>
        ) : flattened.length === 0 ? (
          <div className="m-3 text-fg-subtle">Empty project. Use a session terminal to add files.</div>
        ) : (
          flattened.map((entry) => (
            <TreeRow
              key={entry.node.path || "__root__"}
              entry={entry}
              expanded={expanded.has(entry.node.path)}
              flashed={flash.has(entry.node.path)}
              onToggle={() => toggle(entry.node.path)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface FlattenedEntry {
  node: FsNode;
  depth: number;
}

function flatten(root: FsNode, expanded: Set<string>): FlattenedEntry[] {
  const out: FlattenedEntry[] = [];
  function visit(node: FsNode, depth: number) {
    out.push({ node, depth });
    if (node.type === "directory" && expanded.has(node.path) && node.children) {
      for (const c of node.children) visit(c, depth + 1);
    }
  }
  visit(root, 0);
  return out;
}

interface TreeRowProps {
  entry: FlattenedEntry;
  expanded: boolean;
  flashed: boolean;
  onToggle: () => void;
}

function TreeRow({ entry, expanded, flashed, onToggle }: TreeRowProps) {
  const { node, depth } = entry;
  const isDir = node.type === "directory";
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : FileIcon;

  return (
    <button
      onClick={isDir ? onToggle : undefined}
      className={cn(
        "flex w-full items-center gap-1 px-2 py-0.5 text-left transition-colors",
        "hover:bg-bg-muted",
        flashed && "bg-accent/15",
        !isDir && "cursor-default",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {isDir ? (
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-fg-subtle transition-transform",
            expanded && "rotate-90",
          )}
        />
      ) : (
        <span className="h-3 w-3 shrink-0" />
      )}
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isDir ? "text-accent" : "text-fg-subtle",
        )}
      />
      <span className={cn("truncate", flashed && "text-accent-hover")}>
        {node.name || "/"}
      </span>
    </button>
  );
}
