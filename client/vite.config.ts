import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig(({ mode }) => {
  // Load .env from repo root, not client/, so server + client share one file.
  const repoRoot = path.resolve(__dirname, "..");
  const env = loadEnv(mode, repoRoot, "");
  const serverPort = Number.parseInt(env.SERVER_PORT ?? "4000", 10);
  const clientPort = Number.parseInt(env.CLIENT_PORT ?? "5173", 10);
  const backend = `http://localhost:${serverPort}`;

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
      port: clientPort,
      strictPort: true,
      proxy: {
        "/api": { target: backend, changeOrigin: true },
        "/ttyd": { target: backend, changeOrigin: true, ws: true },
        "/socket.io": { target: backend, changeOrigin: true, ws: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
