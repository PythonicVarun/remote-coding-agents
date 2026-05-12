import express, { Router } from "express";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getProject } from "../store/projects.js";
import {
  mkdirSafe,
  readFileSafe,
  readTree,
  resolveSafe,
  writeFileSafe,
} from "../services/fs-tree.js";

type ProjectParam = { projectId: string };

export const fsRouter = Router({ mergeParams: true });

// Mounted under /projects/:projectId/fs

fsRouter.get<ProjectParam>("/tree", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const tree = await readTree(project.path);
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

fsRouter.get<ProjectParam>("/file", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const q = z.object({ path: z.string().min(1) }).parse(req.query);
    const result = await readFileSafe(project.path, q.path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Serve a project file raw to the browser (for inline previews).
fsRouter.get<ProjectParam>("/raw", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const q = z.object({ path: z.string().min(1) }).parse(req.query);
    const abs = resolveSafe(project.path, q.path);
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      res.status(400).json({ error: "not a file" });
      return;
    }
    // sendFile handles content-type and byte-range requests automatically
    res.sendFile(abs, (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
});

// Stream a project file to the browser as an attachment.
fsRouter.get<ProjectParam>("/download", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const q = z.object({ path: z.string().min(1) }).parse(req.query);
    const abs = resolveSafe(project.path, q.path);
    const st = await fs.stat(abs);
    if (!st.isFile()) {
      res.status(400).json({ error: "not a file" });
      return;
    }
    const name = path.basename(abs);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    res.setHeader("Content-Length", String(st.size));
    const stream = createReadStream(abs);
    stream.on("error", next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// Create a new subdirectory inside the project. Parent must already exist.
fsRouter.post<ProjectParam>("/mkdir", async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    const body = z
      .object({ dir: z.string().default(""), name: z.string().min(1) })
      .parse(req.body);
    const result = await mkdirSafe(project.path, body.dir, body.name);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Upload a single file (raw body, one file per request). The frontend
// iterates for multi-file drops, which keeps this endpoint dependency-free.
fsRouter.post<ProjectParam>(
  "/upload",
  express.raw({ type: "*/*", limit: "100mb" }),
  async (req, res, next) => {
    try {
      const project = await getProject(req.params.projectId);
      const q = z
        .object({ dir: z.string().default(""), name: z.string().min(1) })
        .parse(req.query);
      const body = req.body;
      if (!Buffer.isBuffer(body)) {
        res.status(400).json({ error: "empty body" });
        return;
      }
      const result = await writeFileSafe(project.path, q.dir, q.name, body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
