import { Router } from "express";
import { z } from "zod";
import { createProject, deleteProject, getProject, listProjects } from "../store/projects.js";
import { listSessions } from "../store/sessions.js";
import { stopAndDeleteSession } from "../services/session-manager.js";
import { reconcileProjectsWithDisk } from "../services/project-reconciler.js";

export const projectsRouter = Router();

projectsRouter.get("/", async (_req, res, next) => {
  try {
    await reconcileProjectsWithDisk();
    res.json(await listProjects());
  } catch (err) {
    next(err);
  }
});

projectsRouter.post("/", async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    await reconcileProjectsWithDisk();
    const project = await createProject(body.name);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

projectsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getProject(req.params.id!));
  } catch (err) {
    next(err);
  }
});

projectsRouter.delete("/:id", async (req, res, next) => {
  try {
    const query = z
      .object({ removeFiles: z.enum(["true", "false"]).optional() })
      .parse(req.query);
    const removeFiles = query.removeFiles === "true";

    // Stop every session belonging to this project first.
    const sessions = await listSessions(req.params.id!);
    for (const s of sessions) {
      // eslint-disable-next-line no-await-in-loop
      await stopAndDeleteSession(s.id).catch(() => undefined);
    }
    await deleteProject(req.params.id!, { removeFiles });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
