import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// repo root is two levels above src/ (server/src -> server -> repo root)
const repoRoot = path.resolve(here, "..", "..");

// Load .env from repo root if present.
loadEnv({ path: path.join(repoRoot, ".env") });

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`env ${name} must be an integer, got "${raw}"`);
  return n;
}

function resolvePath(value: string | undefined, fallback: string): string {
  const p = value && value.trim().length > 0 ? value : fallback;
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

const projectsRoot = resolvePath(process.env.PROJECTS_ROOT, "./projects");
const dataRoot = resolvePath(process.env.DATA_ROOT, "./data");
const clientDistRoot = path.join(repoRoot, "client", "dist");
const clientIndexFile = path.join(clientDistRoot, "index.html");

// Ensure runtime dirs exist on boot.
for (const dir of [projectsRoot, dataRoot]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const config = {
  repoRoot,
  serverPort: envInt("SERVER_PORT", 4000),
  clientPort: envInt("CLIENT_PORT", 5173),
  projectsRoot,
  dataRoot,
  clientDistRoot,
  clientIndexFile,
  agentImage: process.env.AGENT_IMAGE?.trim() || "rca-agent:latest",
  dockerHostWorkspaceRoot: process.env.DOCKER_HOST_WORKSPACE_ROOT?.trim() || "",
  dockerHostProjectsRoot: process.env.DOCKER_HOST_PROJECTS_ROOT?.trim() || "",
  ttydPortMin: envInt("TTYD_PORT_MIN", 7700),
  ttydPortMax: envInt("TTYD_PORT_MAX", 7800),
  // Credentials forwarded to agent containers. Agent-specific keys are scoped
  // to their matching agent kind; llmFoundry is forwarded to all agent kinds
  // so the OCR (and other LLM Foundry) tools work regardless of agent.
  apiKeys: {
    anthropic: process.env.ANTHROPIC_API_KEY?.trim() || "",
    anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL?.trim() || "",
    anthropicAuthToken: process.env.ANTHROPIC_AUTH_TOKEN?.trim() || "",
    openai: process.env.OPENAI_API_KEY?.trim() || "",
    gemini:
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      "",
    github: process.env.GITHUB_TOKEN?.trim() || "",
    llmFoundry: process.env.LLMFOUNDRY_TOKEN?.trim() || "",
  },
  // Allow the frontend origin during dev. Tighten in prod.
  corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
  // Extra `host:ip` mappings added to every session container's
  // /etc/hosts via Docker's ExtraHosts. Comma-separated. Defaults to
  // `host.docker.internal:host-gateway` so bare-Linux Docker matches
  // Docker Desktop / Codespaces behavior. Set to an empty string to
  // disable.
  containerExtraHosts: (process.env.CONTAINER_EXTRA_HOSTS ??
    "host.docker.internal:host-gateway")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
} as const;

export type Config = typeof config;
