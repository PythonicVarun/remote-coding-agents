import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { config } from "./config.js";
import { projectsRouter } from "./routes/projects.js";
import { sessionsRouter } from "./routes/sessions.js";
import { fsRouter } from "./routes/fs.js";
import { ttydHttpHandler } from "./services/ttyd-proxy.js";
import { HttpError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";

const log = logger("app");

export function buildApp(): Express {
  const app = express();

  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use("/ttyd", ttydHttpHandler);

  app.use("/api/projects", projectsRouter);
  app.use("/api/projects/:projectId/sessions", sessionsRouter);
  app.use("/api/projects/:projectId/fs", fsRouter);

  // 404 fallback for unknown /api routes
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Centralized error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    log.error("unhandled error", { path: req.path, err: String(err) });
    const msg = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: msg });
  });

  return app;
}
