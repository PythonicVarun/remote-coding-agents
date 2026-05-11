#!/usr/bin/env bash
# Entrypoint for the agent container.
#
# Env contract (set by the backend when creating the container):
#   AGENT_KIND   = "claude" | "shell"   (default: shell)
#   TTYD_PORT    = port ttyd binds inside the container (default: 7681)
#   TTYD_AUTH    = "user:pass" for ttyd basic auth (optional)
#   INITIAL_CMD  = optional command to execute in the spawned shell

set -euo pipefail

AGENT_KIND="${AGENT_KIND:-shell}"
TTYD_PORT="${TTYD_PORT:-7681}"

# Build the inner command that ttyd spawns for each WebSocket client.
case "$AGENT_KIND" in
  claude)
    # Yolo / autopilot mode. The host is responsible for providing
    # ANTHROPIC_API_KEY via container env or a mounted credentials file.
    if [[ -n "${INITIAL_CMD:-}" ]]; then
      INNER=(bash -lc "cd /workspace && claude --dangerously-skip-permissions ${INITIAL_CMD@Q}; exec bash -l")
    else
      INNER=(bash -lc "cd /workspace && claude --dangerously-skip-permissions || exec bash -l; exec bash -l")
    fi
    ;;
  shell|*)
    if [[ -n "${INITIAL_CMD:-}" ]]; then
      INNER=(bash -lc "cd /workspace && ${INITIAL_CMD}; exec bash -l")
    else
      INNER=(bash -l)
    fi
    ;;
esac

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

echo "[entrypoint] AGENT_KIND=$AGENT_KIND TTYD_PORT=$TTYD_PORT"
echo "[entrypoint] launching: ttyd ${TTYD_ARGS[*]} -- ${INNER[*]}"

exec ttyd "${TTYD_ARGS[@]}" -- "${INNER[@]}"
