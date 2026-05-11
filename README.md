# Remote Coding Agents

A self-hosted web workbench for running containerised AI coding agents.

Create a project, open it, and you get a three-pane workspace: a **live file tree** of the project on disk, an **embedded terminal** (ttyd) into a Docker container that has the project folder bind-mounted, and a **chat panel** to talk to the agent. The agent runs in YOLO mode inside the container so it can edit files, run commands, and you watch it all happen live.

> Status: work in progress. See "Project status" below for what's wired up so far.

---

## Quickstart

```bash
git clone <this-repo>
cd remote-coding-agents
node scripts/setup.mjs        # interactive TUI: checks prereqs, installs, builds agent image
npm run dev                   # starts backend + frontend
```

Open <http://localhost:5173>.

## Prerequisites

- Node.js >= 20
- Docker (Desktop on Windows/macOS, or the engine on Linux) — running and reachable from the user that will run the server
- Ports 4000 (backend), 5173 (frontend dev), and 7700-7800 (ttyd sessions) free, or override in `.env`

## Architecture

```
remote-coding-agents/
├── server/        # Express + Socket.IO + dockerode (TypeScript)
├── client/        # React + Vite + Tailwind (TypeScript)
├── docker/agent/  # Dockerfile for the agent container (ttyd + node + git + claude-code)
├── scripts/       # setup.mjs (TUI bootstrap) and helpers
├── projects/      # Where user project folders live — bind-mounted into agent containers
└── data/          # JSON-backed metadata for projects and sessions
```

**Request flow:** browser → backend REST/Socket.IO → dockerode → agent container. Each session is its own container running ttyd on a host port; the backend reverse-proxies that WebSocket so the iframe loads under the same origin.

## Project status

- [x] Repo scaffold, .gitignore, env template
- [ ] Agent container image
- [ ] Backend (projects, sessions, FS, docker, ttyd proxy)
- [ ] Frontend (project list, workspace with tree + terminal + chat)
- [ ] Setup TUI
- [ ] Polish + this README expansion

## Development

```bash
npm run dev              # parallel server + client with hot reload
npm run build            # production build of both
npm run docker:build-agent  # rebuild the agent image
```

## Configuration

See `.env.example` for all knobs. Copy to `.env` and edit.

## License

TBD.
