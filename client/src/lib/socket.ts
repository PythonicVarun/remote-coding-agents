import { io, type Socket } from "socket.io-client";

let singleton: Socket | null = null;

export function getSocket(): Socket {
  if (singleton && singleton.connected) return singleton;
  if (singleton) return singleton;
  singleton = io({
    path: "/socket.io",
    autoConnect: true,
    transports: ["websocket", "polling"],
  });
  return singleton;
}
