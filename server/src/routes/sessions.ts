import { Router } from "express";
import { z } from "zod";
import {
  createAndStartSession,
  stopAndDeleteSession,
} from "../services/session-manager.js";
import { getSession, listSessions } from "../store/sessions.js";
import { getProject } from "../store/projects.js";

export const sessionsRouter = Router({ mergeParams: true });

// Nested under /projects/:projectId/sessions

sessionsRouter.get("/", async (req, res, next) => {
  try {
    const projectId = req.params.projectId!;
    await getProject(projectId); // 404 if missing
    res.json(await listSessions(projectId));
  } catch (err) {
    next(err);
  }
});

sessionsRouter.post("/", async (req, res, next) => {
  try {
    const projectId = req.params.projectId!;
    const body = z
      .object({
        title: z.string().min(1).max(120),
        agent: z.enum(["claude", "shell"]),
        containerStrategy: z.enum(["per-session", "per-project"]),
      })
      .parse(req.body);

    const session = await createAndStartSession({
      projectId,
      title: body.title,
      agent: body.agent,
      containerStrategy: body.containerStrategy,
    });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get("/:sessionId", async (req, res, next) => {
  try {
    res.json(await getSession(req.params.sessionId!));
  } catch (err) {
    next(err);
  }
});

sessionsRouter.delete("/:sessionId", async (req, res, next) => {
  try {
    await stopAndDeleteSession(req.params.sessionId!);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
