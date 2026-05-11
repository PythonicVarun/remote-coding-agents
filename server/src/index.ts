import http from "node:http";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { attachSocketIO } from "./sockets/index.js";
import { attachTtydUpgrade } from "./services/ttyd-proxy.js";
import { adoptRunningSessions, ensureDockerReady } from "./services/docker.js";
import { shutdownAll } from "./services/fs-watcher.js";
import { logger } from "./lib/logger.js";

const log = logger("boot");

async function main(): Promise<void> {
  const app = buildApp();
  const server = http.createServer(app);

  // ttyd WS upgrades are handled BEFORE Socket.IO attaches so it can opt out
  // of upgrades that aren't on its path. Socket.IO inspects upgrade events
  // for its own path (/socket.io) and ignores others.
  attachTtydUpgrade(server);
  attachSocketIO(server);

  // Docker setup. Don't crash if Docker isn't running — log clearly and
  // continue so the user can still navigate the UI and read errors.
  try {
    await ensureDockerReady();
    await adoptRunningSessions();
    log.info("docker ready");
  } catch (err) {
    log.warn("docker unavailable — session creation will fail until Docker is up", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  server.listen(config.serverPort, () => {
    log.info("server listening", {
      port: config.serverPort,
      projectsRoot: config.projectsRoot,
      dataRoot: config.dataRoot,
      agentImage: config.agentImage,
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info("shutting down", { signal });
    server.close();
    await shutdownAll();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("fatal boot error", { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
