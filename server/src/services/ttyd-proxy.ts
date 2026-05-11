// Reverse-proxy each session's ttyd HTTP+WebSocket through the backend.
//
// Why: ttyd binds to 127.0.0.1:<port> inside the host. The browser embeds it
// in an iframe. Routing it through the backend means:
//   1) the iframe loads under the backend origin (no third-party cookie / port jail)
//   2) we can later add auth, audit, kill-switch, etc.
//
// URL shape: /ttyd/:sessionId/...  -> 127.0.0.1:<port>/...
// WebSocket: /ttyd/:sessionId/ws    -> 127.0.0.1:<port>/ws

import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage } from "node:http";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import httpProxy from "http-proxy";
import { getSession } from "../store/sessions.js";
import { logger } from "../lib/logger.js";

const log = logger("ttyd-proxy");

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
  prependPath: false,
  xfwd: false,
});

proxy.on("error", (err, _req, res) => {
  log.warn("proxy error", { err: String(err) });
  // res may be a ServerResponse or Socket depending on http vs ws path.
  if (res && "writeHead" in res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("upstream ttyd unreachable");
  } else if (res && "destroy" in res) {
    res.destroy();
  }
});

function parseSessionFromPath(url: string): { sessionId: string; rest: string } | null {
  // Strip leading slash, split into segments.
  const trimmed = url.replace(/^\/+/, "");
  // Match either "ttyd/<id>/<rest...>" (from server upgrade) or "<id>/<rest...>" (from Express)
  const m = /^(?:ttyd\/)?([A-Za-z0-9_-]+)(\/.*)?$/.exec(trimmed);
  if (!m) return null;
  return { sessionId: m[1]!, rest: m[2] ?? "/" };
}

async function resolveTarget(sessionId: string): Promise<string | null> {
  try {
    const session = await getSession(sessionId);
    if (session.status !== "running" || !session.ttydPort) return null;
    return `http://127.0.0.1:${session.ttydPort}`;
  } catch {
    return null;
  }
}

/** Express middleware: handles plain-HTTP requests to /ttyd/:sessionId/... */
export async function ttydHttpHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  const parsed = parseSessionFromPath(req.url);
  if (!parsed) {
    next();
    return;
  }
  const target = await resolveTarget(parsed.sessionId);
  if (!target) {
    res.status(404).send("session not running");
    return;
  }
  // Rewrite URL so ttyd sees its own paths.
  req.url = parsed.rest;
  proxy.web(req, res, { target });
}

/** Wire up WebSocket upgrade handling on the bare http.Server. */
export function attachTtydUpgrade(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const parsed = parseSessionFromPath(req.url);
    if (!parsed) {
      // Not ours — Socket.IO handles its own upgrades on /socket.io path.
      return;
    }
    resolveTarget(parsed.sessionId)
      .then((target) => {
        if (!target) {
          socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
          socket.destroy();
          return;
        }
        req.url = parsed.rest;
        proxy.ws(req, socket, head, { target });
      })
      .catch((err) => {
        log.warn("upgrade resolve failed", { err: String(err) });
        socket.destroy();
      });
  });
}
