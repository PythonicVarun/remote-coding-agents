import { Router } from "express";
import { z } from "zod";
import {
  createAndStartSession,
  stopAndDeleteSession,
} from "../services/session-manager.js";
import { getSession, listSessions } from "../store/sessions.js";
import { getProject } from "../store/projects.js";
import { sendChatToSession } from "../services/chat.js";
import { badRequest } from "../lib/errors.js";

type ProjectParam = { projectId: string };
type ProjectAndSessionParam = { projectId: string; sessionId: string };

export const sessionsRouter = Router({ mergeParams: true });

// Nested under /projects/:projectId/sessions

sessionsRouter.get<ProjectParam>("/", async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
    await getProject(projectId); // 404 if missing
    res.json(await listSessions(projectId));
  } catch (err) {
    next(err);
  }
});

sessionsRouter.post<ProjectParam>("/", async (req, res, next) => {
  try {
    const projectId = req.params.projectId;
      const body = z
        .object({
          title: z.string().min(1).max(120),
          agent: z.enum(["claude", "codex", "gemini", "copilot", "shell"]),
          containerStrategy: z.enum(["per-session", "per-project"]),
          initialPrompt: z.string().max(8000).optional(),
        })
        .parse(req.body);

      const session = await createAndStartSession({
        projectId,
        title: body.title,
        agent: body.agent,
        containerStrategy: body.containerStrategy,
        initialPrompt: body.initialPrompt,
      });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get<ProjectAndSessionParam>("/:sessionId", async (req, res, next) => {
  try {
    res.json(await getSession(req.params.sessionId));
  } catch (err) {
    next(err);
  }
});

sessionsRouter.delete<ProjectAndSessionParam>("/:sessionId", async (req, res, next) => {
  try {
    await stopAndDeleteSession(req.params.sessionId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

sessionsRouter.post<ProjectAndSessionParam>("/:sessionId/chat", async (req, res, next) => {
  try {
    const body = z.object({ text: z.string().min(1).max(8000) }).parse(req.body);
    const session = await getSession(req.params.sessionId);
    if (session.status !== "running" || !session.containerId) {
      throw badRequest("session is not running");
    }
    await sendChatToSession(session.containerId, body.text);
    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
