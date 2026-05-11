#!/usr/bin/env bash
# Entrypoint for the agent container.
#
# Env contract (set by the backend when creating the container):
#   AGENT_KIND   = "claude" | "shell"   (default: shell)
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

case "$AGENT_KIND" in
  claude)
    # Yolo / autopilot mode. Host must provide ANTHROPIC_API_KEY.
    if command -v claude >/dev/null 2>&1; then
      if [[ -n "${INITIAL_CMD:-}" ]]; then
        INNER_CMD="cd /workspace && claude --dangerously-skip-permissions ${INITIAL_CMD@Q}; exec bash -l"
      else
        INNER_CMD="cd /workspace && (claude --dangerously-skip-permissions || true); exec bash -l"
      fi
    else
      INNER_CMD="echo '[agent] claude CLI not installed; falling back to shell'; cd /workspace; exec bash -l"
    fi
    ;;
  shell|*)
    if [[ -n "${INITIAL_CMD:-}" ]]; then
      INNER_CMD="cd /workspace && ${INITIAL_CMD}; exec bash -l"
    else
      INNER_CMD="cd /workspace; exec bash -l"
    fi
    ;;
esac

echo "[entrypoint] AGENT_KIND=$AGENT_KIND TTYD_PORT=$TTYD_PORT"

# Start (or re-create) the tmux session running the inner command.
tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
tmux new-session -d -s "$TMUX_SESSION" -x 200 -y 50 bash -lc "$INNER_CMD"

TTYD_ARGS=(
  --writable
  --port "$TTYD_PORT"
  --interface 0.0.0.0
  --max-clients 4
  --check-origin=false
  --terminal-type xterm-256color
)
if [[ -n "${TTYD_AUTH:-}" ]]; then
  TTYD_ARGS+=(--credential "$TTYD_AUTH")
fi

echo "[entrypoint] launching ttyd attached to tmux session '$TMUX_SESSION'"
exec ttyd "${TTYD_ARGS[@]}" -- tmux attach -t "$TMUX_SESSION"
