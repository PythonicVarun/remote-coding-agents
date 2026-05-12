import { useState } from "react";
import { Link } from "react-router-dom";
import { Folder, MoreHorizontal, Trash2 } from "lucide-react";
import type { Project } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ProjectCardProps {
  project: Project;
  onDelete: (id: string, removeFiles: boolean) => Promise<void>;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ removeFiles: boolean } | null>(null);

  const requestDelete = (removeFiles: boolean) => {
    setMenuOpen(false);
    setPendingDelete({ removeFiles });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await onDelete(project.id, pendingDelete.removeFiles);
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border bg-bg-subtle/95 p-4 shadow-panel transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/projects/${project.id}`} className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
            <Folder className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg">{project.name}</div>
            <div className="truncate text-xs text-fg-subtle">{project.path}</div>
          </div>
        </Link>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Project menu"
            className="rounded-md p-1 text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div
              className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-bg-elevated p-1 shadow-lg"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                onClick={() => requestDelete(false)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-muted hover:bg-bg-muted hover:text-fg"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove from list
              </button>
              <button
                onClick={() => requestDelete(true)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-danger hover:bg-danger-subtle"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete folder on disk
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Badge tone="neutral">{new Date(project.createdAt).toLocaleDateString()}</Badge>
        <Link
          to={`/projects/${project.id}`}
          className="text-xs font-medium text-accent hover:text-accent-hover"
        >
          Open →
        </Link>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.removeFiles ? "Delete project and its files?" : "Remove project from list?"}
        description={
          pendingDelete?.removeFiles
            ? "The project folder will be permanently deleted from disk."
            : "The project will be removed from the list. Files on disk are untouched."
        }
        confirmLabel={pendingDelete?.removeFiles ? "Delete files" : "Remove"}
        tone={pendingDelete?.removeFiles ? "danger" : "primary"}
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => (busy ? undefined : setPendingDelete(null))}
      >
        <div className="space-y-2 text-sm text-fg-muted">
          <p>
            <span className="font-medium text-fg">{project.name}</span>
          </p>
          <p className="truncate text-xs text-fg-subtle">{project.path}</p>
          {pendingDelete?.removeFiles ? (
            <div className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
              This cannot be undone.
            </div>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
