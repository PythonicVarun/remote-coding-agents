import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { isValidProjectName, slugify } from "../lib/slug.js";
import { ensureProjectTreeWritable } from "../services/project-permissions.js";
import { mutate, readState, type Project } from "./state.js";

export async function listProjects(): Promise<Project[]> {
  const s = await readState();
  return s.projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(id: string): Promise<Project> {
  const s = await readState();
  const p = s.projects.find((x) => x.id === id);
  if (!p) throw notFound(`project ${id} not found`);
  return p;
}

export async function createProject(name: string): Promise<Project> {
  const trimmed = name.trim();
  if (!isValidProjectName(trimmed)) {
    throw badRequest("project name must be 1-80 chars of letters/digits/space/_-.");
  }
  const baseSlug = slugify(trimmed);

  return mutate(async (state) => {
    // Ensure unique slug so folder name doesn't collide.
    let slug = baseSlug;
    let suffix = 1;
    while (state.projects.some((p) => p.slug === slug)) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }

    const dir = path.join(config.projectsRoot, slug);
    try {
      await fs.mkdir(dir, { recursive: false });
      await ensureProjectTreeWritable(dir);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") throw conflict(`folder ${slug} already exists on disk`);
      throw err;
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: nanoid(12),
      name: trimmed,
      slug,
      path: dir,
      createdAt: now,
      updatedAt: now,
    };
    state.projects.push(project);
    return project;
  });
}

export async function deleteProject(id: string, opts: { removeFiles: boolean }): Promise<void> {
  const project = await getProject(id);

  await mutate(async (state) => {
    state.projects = state.projects.filter((p) => p.id !== id);
    // Don't orphan sessions in state. Callers should have stopped them first.
    state.sessions = state.sessions.filter((s) => s.projectId !== id);
  });

  if (opts.removeFiles) {
    await fs.rm(project.path, { recursive: true, force: true });
  }
}
