import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { ProjectCard } from "@/components/ProjectCard";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const reload = async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleDelete = async (id: string, removeFiles: boolean) => {
    try {
      await api.deleteProject(id, removeFiles);
      void reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-xs text-fg-muted">
            Each project is a folder on disk that gets bind-mounted into agent containers.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-fg-muted">Loading...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-subtle p-12 text-center">
          <p className="text-sm text-fg-muted">No projects yet.</p>
          <Button variant="primary" className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Create your first project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={handleDelete} />
          ))}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          void reload();
        }}
      />
    </div>
  );
}

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createProject(name.trim());
      onCreated();
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
      title="New project"
      description="A folder with this name will be created under projects/."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating..." : "Create"}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-muted">Project name</span>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-app"
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
      </label>
      {error ? (
        <div className="mt-3 rounded border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}
    </Dialog>
  );
}
