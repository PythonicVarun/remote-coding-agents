import { Router } from "express";
import { z } from "zod";
import { getProject } from "../store/projects.js";
import { readFileSafe, readTree } from "../services/fs-tree.js";

export const fsRouter = Router({ mergeParams: true });

// Mounted under /projects/:projectId/fs

fsRouter.get("/tree", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId!);
    const tree = await readTree(project.path);
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

fsRouter.get("/file", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId!);
    const q = z.object({ path: z.string().min(1) }).parse(req.query);
    const result = await readFileSafe(project.path, q.path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
