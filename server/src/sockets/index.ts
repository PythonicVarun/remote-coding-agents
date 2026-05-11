import { Server as IoServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { config } from "../config.js";
import { getProject } from "../store/projects.js";
import { subscribe } from "../services/fs-watcher.js";
import { logger } from "../lib/logger.js";

const log = logger("io");

export function attachSocketIO(server: HttpServer): IoServer {
  const io = new IoServer(server, {
    cors: { origin: config.corsOrigin, credentials: false },
    path: "/socket.io",
  });

  io.on("connection", (socket: Socket) => {
    log.debug("client connected", { sid: socket.id });

    const unsubFns = new Map<string, () => void>();

    socket.on("project:subscribe", async (projectId: string, ack?: (err?: string) => void) => {
      try {
        const project = await getProject(projectId);
        if (unsubFns.has(projectId)) {
          ack?.();
          return;
        }
        const unsub = subscribe(projectId, project.path, (ev) => {
          socket.emit("fs:event", ev);
        });
        unsubFns.set(projectId, unsub);
        ack?.();
      } catch (err) {
        ack?.(err instanceof Error ? err.message : String(err));
      }
    });

    socket.on("project:unsubscribe", (projectId: string) => {
      const unsub = unsubFns.get(projectId);
      if (unsub) {
        unsub();
        unsubFns.delete(projectId);
      }
    });

    socket.on("disconnect", () => {
      for (const [, unsub] of unsubFns) unsub();
      unsubFns.clear();
      log.debug("client disconnected", { sid: socket.id });
    });
  });

  return io;
}
