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

# Resolve the inner command for each agent kind. Each branch tries the CLI,
# falls back to a friendly message + bash if the CLI isn't installed, and
# always ends in `exec bash -l` so the user can keep working after the
# agent exits.
make_inner() {
  local cli="$1"
  local args="$2"
  local install_hint="$3"
  if command -v "$cli" >/dev/null 2>&1; then
    if [[ -n "${INITIAL_CMD:-}" ]]; then
      printf 'cd /workspace && %s %s %s; exec bash -l' \
        "$cli" "$args" "${INITIAL_CMD@Q}"
    else
      printf 'cd /workspace && (%s %s || true); exec bash -l' \
        "$cli" "$args"
    fi
  else
    printf 'echo "[agent] %s CLI not installed in this image. %s"; cd /workspace; exec bash -l' \
      "$cli" "$install_hint"
  fi
}

case "$AGENT_KIND" in
  claude)
    INNER_CMD=$(make_inner "claude" "--dangerously-skip-permissions" \
      "Install with: sudo npm install -g @anthropic-ai/claude-code")
    ;;
  codex)
    INNER_CMD=$(make_inner "codex" "--full-auto" \
      "Install with: sudo npm install -g @openai/codex")
    ;;
  gemini)
    INNER_CMD=$(make_inner "gemini" "--yolo" \
      "Install with: sudo npm install -g @google/gemini-cli")
    ;;
  copilot)
    INNER_CMD=$(make_inner "copilot" "--allow-all-tools" \
      "Install with: sudo npm install -g @github/copilot")
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
