# Remote Coding Agents

A self-hosted web workbench for running containerised AI coding agents.

Create a project, open it, and you get a three-pane workspace:

- a **live file tree** of the project on disk
- an **embedded terminal** (ttyd) into a Docker container that has the project folder bind-mounted at `/workspace`
- a **chat panel** that injects messages into the running agent

The agent (Claude Code by default) runs in YOLO mode (`--dangerously-skip-permissions`) inside the container — so it can edit files, run commands, install packages — and you watch every step happen live. The container is isolated; your host shell is not.

---

## Quickstart

```bash
git clone <this-repo>
cd remote-coding-agents
node scripts/setup.mjs   # interactive TUI: checks prereqs, installs, builds image
```

The TUI will offer to run `npm run dev` for you at the end. Then open <http://localhost:5173>.

If you'd rather drive it yourself after running setup once:

```bash
npm run dev                  # start backend + frontend in parallel (with hot reload)
npm run build                # production build of both
npm run docker:build-agent   # rebuild the agent container image
```

## Prerequisites

| Tool | Min version | Notes |
| --- | --- | --- |
| **Node.js** | 20 LTS | Required for the server (Express + Socket.IO) and the Vite dev server. |
| **npm** | ships with Node 20 | Workspaces are used to manage `server/` and `client/`. |
| **Docker** | recent | Each session spawns a container. On Windows/macOS use Docker Desktop. On Linux make sure your user is in the `docker` group. |
| **Ports** | 4000, 5173, 7700-7800 | All configurable via `.env`. The 7700-7800 range is for ttyd per session — adjust if you need more concurrent sessions. |
| **Agent API keys** | optional | Required only for the matching agent — see "Supported agents" below. Bare-shell sessions don't need any. |

> **Windows users:** Docker Desktop must be running before you create sessions. WSL2 backend is recommended.

## Architecture

```
remote-coding-agents/
├── server/              # Node 20 + Express + Socket.IO + dockerode (TypeScript)
│   └── src/
│       ├── routes/      # REST: /api/projects, /api/projects/:id/sessions, /api/projects/:id/fs
│       ├── services/    # docker / ports / ttyd-proxy / fs-tree / fs-watcher / chat / session-manager
│       ├── sockets/     # Socket.IO handlers (project:subscribe → fs:event stream)
│       ├── store/       # JSON-file-backed projects + sessions store
│       └── lib/         # logger, errors, slug
├── client/              # React 18 + Vite + TypeScript + Tailwind
│   └── src/
│       ├── pages/       # ProjectsPage, WorkspacePage (3-pane)
│       ├── components/  # FileTree, SessionsPanel, TerminalFrame, ChatPanel, ProjectCard, ui/*
│       └── lib/         # api, socket, types
├── docker/agent/        # Per-session container image
│   ├── Dockerfile       # ubuntu:24.04 + node 20 + git + tmux + ttyd + claude-code
│   └── entrypoint.sh    # Starts agent inside detached tmux session; ttyd attaches
├── scripts/setup.mjs    # TUI bootstrap with @clack/prompts
├── projects/            # User project folders live here (gitignored)
├── data/                # JSON state lives here (gitignored)
└── .env.example
```

### Request flow

```
        ┌──────────────────┐                              ┌──────────────────┐
        │     Browser      │                              │   Docker daemon  │
        │ (React + Vite)   │                              │                  │
        └────────┬─────────┘                              └────────▲─────────┘
                 │  HTTP /api/*                                    │ dockerode
                 │  WebSocket /socket.io                           │
                 │  iframe → /ttyd/<sid>/                          │
                 ▼                                                 │
        ┌──────────────────┐                                       │
        │  Backend (Express│ ─── ttyd reverse proxy (HTTP + WS) ──▶│
        │   + Socket.IO)   │ ─── tmux send-keys (chat) ───────────▶│
        └────────┬─────────┘                                       │
                 │ chokidar                                        │
                 ▼                                                 │
        projects/<slug>/  ◀── bind mount → /workspace ─────────────┘
```

### Why tmux?

The agent runs inside a detached `tmux` session called `agent`. `ttyd` *attaches* to that session for the user's terminal, which lets us also use `tmux send-keys` from `docker exec` to inject text from the web chat panel. Both the iframe terminal and the chat go through the same pty — so you can type interactively in one and send a prompt from the other.

## Supported agents

Each session picks one agent at creation time. The agent image installs all of these at build time on a best-effort basis; missing CLIs can still be installed at runtime inside a session (the `agent` user has passwordless sudo).

| Agent | CLI | Default flags | Credential env var |
| --- | --- | --- | --- |
| **Claude Code** | `claude` (`@anthropic-ai/claude-code`) | `--dangerously-skip-permissions` | `ANTHROPIC_API_KEY` |
| **Codex** | `codex` (`@openai/codex`) | `--full-auto` | `OPENAI_API_KEY` |
| **Gemini CLI** | `gemini` (`@google/gemini-cli`) | `--yolo` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` |
| **GitHub Copilot CLI** | `copilot` (`@github/copilot`) | `--allow-all-tools` | `GITHUB_TOKEN` |
| **Bare shell** | `bash` | — | none |

Only the credential matching the selected agent is forwarded into the container. If you need to change a flag, edit `docker/agent/entrypoint.sh` and rebuild the image (`npm run docker:build-agent`).

## Configuration (`.env`)

All knobs live in `.env`. `scripts/setup.mjs` writes one for you the first time. The full list:

```ini
SERVER_PORT=4000
CLIENT_PORT=5173
PROJECTS_ROOT=./projects          # where project folders live (absolute or repo-relative)
DATA_ROOT=./data                  # where state.json is persisted
AGENT_IMAGE=rca-agent:latest      # docker image tag for the agent container
TTYD_PORT_MIN=7700                # host port range used to publish each session's ttyd
TTYD_PORT_MAX=7800
ANTHROPIC_API_KEY=                # required for Claude Code sessions
OPENAI_API_KEY=                   # required for Codex sessions
GEMINI_API_KEY=                   # required for Gemini sessions (GOOGLE_API_KEY also accepted)
GITHUB_TOKEN=                     # required for GitHub Copilot CLI sessions
```

Restart `npm run dev` after editing `.env`.

## Using the app

1. **Create a project.** This makes a folder under `projects/<slug>/`. Place any starter files there manually if you want, or let the agent create them.
2. **Open the project.** The workspace appears with the live file tree on the left.
3. **Create a session.** Choose:
   - **Agent**: Claude Code, Codex, Gemini CLI, GitHub Copilot CLI, or bare shell.
   - **Container**: a fresh container for this session, or attach to the project's existing container (sessions sharing one container share the same tmux pane).
4. **Watch and steer.** The terminal pane shows the agent's commands live; the file tree highlights writes; the chat panel sends typed instructions into the pane.
5. **Stop the session.** Hover the session card and click the trash icon — the container is stopped and removed.

## Security notes

- The agent runs in **YOLO mode** by design, so it can run arbitrary commands inside its container. The blast radius is the **container**, plus the bind-mounted **project folder**. Don't bind-mount anything you don't want the agent to be able to modify.
- The ttyd WebSocket is bound to `127.0.0.1` on the host and reverse-proxied through the backend; it isn't exposed to your network.
- There's no auth on the backend itself — this is intended to run locally. If you expose it, put it behind a reverse proxy with auth.
- `.env` is gitignored. Don't commit `ANTHROPIC_API_KEY`.

## Troubleshooting

- **"agent image rca-agent:latest not found"** — Run `npm run docker:build-agent`.
- **"could not reach the Docker daemon"** — Start Docker Desktop (Windows/macOS) or `sudo systemctl start docker` (Linux). The backend reports this in the boot log; sessions will fail to create.
- **ttyd iframe shows "session not running"** — The session container exited. Check `docker logs rca-<sessionId>` for the stack trace, then delete the session and create a new one.
- **Claude Code says it can't find an API key** — Set `ANTHROPIC_API_KEY` in `.env`, restart the backend, and create a fresh session. (Containers receive the key at creation time.)
- **File tree doesn't update** — Make sure your platform supports inotify-style watches. On Windows, mount the project on a local NTFS volume rather than over a network share.

## Development

```bash
npm run dev                     # parallel server + client with hot reload
npm --workspace server run dev  # backend only (tsx watch)
npm --workspace client run dev  # frontend only (vite)
npm --workspace server run lint # tsc --noEmit on server
npm --workspace client run lint # tsc --noEmit on client
npm run build                   # production build of both
```

The Vite dev server proxies `/api`, `/socket.io`, and `/ttyd` to the backend, so the frontend at `:5173` looks like a single origin even though the backend runs on `:4000`.

## License

TBD.
