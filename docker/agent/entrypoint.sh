#!/usr/bin/env bash
# Entrypoint for the agent container.
#
# Env contract (set by the backend when creating the container):
#   AGENT_KIND   = "claude" | "codex" | "gemini" | "copilot" | "shell"
#                  (default: shell)
#   TTYD_PORT    = port ttyd binds inside the container (default: 7681)
#   TTYD_AUTH    = "user:pass" for ttyd basic auth (optional)
#   INITIAL_CMD  = optional command to execute in the spawned shell
#
# Layout:
#   The agent runs inside a detached tmux session called "agent".
#   ttyd attaches to that session for the user's terminal.
#   The backend can inject text via:
#     docker exec <id> tmux send-keys -t agent -l "<text>"
#     docker exec <id> tmux send-keys -t agent Enter
#   That powers the web chat panel.

set -euo pipefail

AGENT_KIND="${AGENT_KIND:-shell}"
TTYD_PORT="${TTYD_PORT:-7681}"
TMUX_SESSION="agent"

echo "[entrypoint] AGENT_KIND=$AGENT_KIND TTYD_PORT=$TTYD_PORT"
CURRENT_HOME="${HOME:-}"
if [[ -z "$CURRENT_HOME" || ! -d "$CURRENT_HOME" || ! -w "$CURRENT_HOME" ]]; then
  HOME="$(mktemp -d /tmp/rca-home.XXXXXX)"
  export HOME
fi

# Start (or re-create) the tmux session running the shell or the agent
# supervisor. The supervisor keeps the interactive agent alive and resumes the
# latest conversation if the user exits the CLI or it crashes.
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
if [[ "$AGENT_KIND" == "shell" ]]; then
  if [[ -n "${INITIAL_CMD:-}" ]]; then
    INNER_CMD="cd /workspace && ${INITIAL_CMD}; exec bash -l"
  else
    INNER_CMD="cd /workspace; exec bash -l"
  fi
  tmux new-session -d -s "$TMUX_SESSION" -x 200 -y 50 bash -lc "$INNER_CMD"
else
  tmux new-session -d -s "$TMUX_SESSION" -x 200 -y 50 /usr/local/bin/agent-supervisor.sh
fi

TTYD_ARGS=(
  --writable
  --port "$TTYD_PORT"
  --interface 0.0.0.0
  --max-clients 4
  --terminal-type xterm-256color
)
if [[ -n "${TTYD_AUTH:-}" ]]; then
  TTYD_ARGS+=(--credential "$TTYD_AUTH")
fi

echo "[entrypoint] launching ttyd attached to tmux session '$TMUX_SESSION'"
exec ttyd "${TTYD_ARGS[@]}" -- tmux attach -t "$TMUX_SESSION"