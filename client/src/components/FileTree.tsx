import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderOpen,
  RotateCw,
  Upload,
} from "lucide-react";
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
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Upload files to `dir` (POSIX relative path; "" = project root).
  const uploadFiles = useCallback(
    async (files: File[], dir: string) => {
      if (files.length === 0) return;
      setUploading({ done: 0, total: files.length });
      setError(null);
      try {
        let done = 0;
        for (const file of files) {
          await api.uploadFile(projectId, dir, file);
          done += 1;
          setUploading({ done, total: files.length });
        }
        // fs:watcher will fire and refresh, but kick one immediately for snappier UX.
        void refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "upload failed");
      } finally {
        setUploading(null);
      }
    },
    [projectId, refresh],
  );

  const openPicker = () => fileInputRef.current?.click();

  const onPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    const files = Array.from(list);
    e.target.value = ""; // allow re-picking the same file
    void uploadFiles(files, "");
  };

  // Drag-and-drop wiring on the scroll container. Uses a counter to avoid
  // false negatives when dragenter/dragleave fires on child elements.
  const onContainerDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    if (dragOverPath === null) setDragOverPath("");
  };
  const onContainerDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onContainerDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOverPath(null);
  };
  const onContainerDrop = (e: React.DragEvent, targetDir: string) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOverPath(null);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void uploadFiles(files, targetDir);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Files</div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={openPicker}
            disabled={uploading !== null}
            aria-label="Upload files"
            title="Upload files"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            aria-label="Refresh tree"
            title="Refresh"
          >
            <RotateCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPickerChange}
      />

      {uploading ? (
        <div className="border-b border-border-subtle bg-accent-subtle/40 px-3 py-1.5 text-xs text-accent-hover">
          Uploading {uploading.done}/{uploading.total}…
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex-1 overflow-auto py-1 font-mono text-xs transition-colors",
          dragOverPath !== null && "ring-2 ring-inset ring-accent/60 bg-accent-subtle/20",
        )}
        onDragEnter={onContainerDragEnter}
        onDragOver={onContainerDragOver}
        onDragLeave={onContainerDragLeave}
        onDrop={(e) => onContainerDrop(e, "")}
      >
        {error ? (
          <div className="m-3 rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-danger">
            {error}
          </div>
        ) : flattened.length === 0 ? (
          <div className="m-3 text-fg-subtle">
            Empty project. Drop files here, click upload above, or use a session terminal.
          </div>
        ) : (
          flattened.map((entry) => (
            <TreeRow
              key={entry.node.path || "__root__"}
              projectId={projectId}
              entry={entry}
              expanded={expanded.has(entry.node.path)}
              flashed={flash.has(entry.node.path)}
              dragOver={dragOverPath === entry.node.path}
              onToggle={() => toggle(entry.node.path)}
              onRowDragEnter={(path) => setDragOverPath(path)}
              onRowDrop={onContainerDrop}
            />
          ))
        )}

        {dragOverPath !== null ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-1 mx-3 rounded-md border border-accent/40 bg-bg-elevated/85 px-3 py-1.5 text-center text-xs text-accent-hover shadow-panel">
            Drop to upload into{" "}
            <span className="font-mono">/{dragOverPath || ""}</span>
          </div>
        ) : null}
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
  projectId: string;
  entry: FlattenedEntry;
  expanded: boolean;
  flashed: boolean;
  dragOver: boolean;
  onToggle: () => void;
  onRowDragEnter: (path: string) => void;
  onRowDrop: (e: React.DragEvent, targetDir: string) => void;
}

function TreeRow({
  projectId,
  entry,
  expanded,
  flashed,
  dragOver,
  onToggle,
  onRowDragEnter,
  onRowDrop,
}: TreeRowProps) {
  const { node, depth } = entry;
  const isDir = node.type === "directory";
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : FileIcon;

  // For directories, advertise ourselves as the drop target on enter.
  // For files, we let the container handle drops at root.
  const rowDragHandlers = isDir
    ? {
        onDragEnter: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.stopPropagation();
          onRowDragEnter(node.path);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        },
        onDrop: (e: React.DragEvent) => onRowDrop(e, node.path),
      }
    : {};

  return (
    <div
      className={cn(
        "group relative flex items-center",
        dragOver && "bg-accent/15",
      )}
      {...rowDragHandlers}
    >
      <button
        onClick={isDir ? onToggle : undefined}
        className={cn(
          "flex flex-1 items-center gap-1 px-2 py-0.5 text-left transition-colors",
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
      {!isDir && node.path ? (
        <a
          href={api.downloadFileUrl(projectId, node.path)}
          download={node.name}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Download ${node.name}`}
          title="Download"
          className={cn(
            "mr-1 hidden h-5 w-5 items-center justify-center rounded text-fg-subtle",
            "hover:bg-bg-elevated hover:text-fg group-hover:flex focus-visible:flex",
          )}
        >
          <Download className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}
