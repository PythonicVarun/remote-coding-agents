#!/usr/bin/env bash
# Restarts interactive agent CLIs in the same tmux pane when they exit, using
# each tool's built-in resume/continue flow when available.

set -euo pipefail

AGENT_KIND="${AGENT_KIND:-shell}"
STATUS_FILE="${RCA_AGENT_STATUS_FILE:-/tmp/rca-agent-status.json}"
RESTART_DELAY_SECONDS="${RCA_AGENT_RESTART_DELAY_SECONDS:-2}"

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

write_status() {
  local state="$1"
  local restart_count="${2:-0}"
  local last_exit_code="${3:-}"
  local last_exit_at="${4:-}"
  local last_crash_at="${5:-}"
  local last_crash_reason="${6:-}"

  STATE="$state" \
  RESTART_COUNT="$restart_count" \
  LAST_EXIT_CODE="$last_exit_code" \
  LAST_EXIT_AT="$last_exit_at" \
  LAST_CRASH_AT="$last_crash_at" \
  LAST_CRASH_REASON="$last_crash_reason" \
  STATUS_FILE="$STATUS_FILE" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

def to_int(value: str):
    if value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None

payload = {
    "state": os.environ["STATE"],
    "restartCount": int(os.environ["RESTART_COUNT"]),
    "lastExitCode": to_int(os.environ["LAST_EXIT_CODE"]),
    "lastExitAt": os.environ["LAST_EXIT_AT"] or None,
    "lastCrashAt": os.environ["LAST_CRASH_AT"] or None,
    "lastCrashReason": os.environ["LAST_CRASH_REASON"] or None,
}

path = Path(os.environ["STATUS_FILE"])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload), encoding="utf-8")
PY
}

run_agent() {
  local mode="$1"

  case "$AGENT_KIND" in
    claude)
      if ! command -v claude >/dev/null 2>&1; then
        echo "[agent] claude CLI not installed in this image. Install with: sudo npm install -g @anthropic-ai/claude-code"
        exec bash -l
      fi
      local -a cmd=(claude --dangerously-skip-permissions)
      if [[ "$mode" == "resume" ]]; then
        cmd+=(--continue)
      elif [[ -n "${INITIAL_CMD:-}" ]]; then
        cmd+=("${INITIAL_CMD}")
      fi
      cd /workspace
      "${cmd[@]}"
      ;;
    codex)
      if ! command -v codex >/dev/null 2>&1; then
        echo "[agent] codex CLI not installed in this image. Install with: sudo npm install -g @openai/codex"
        exec bash -l
      fi
      local -a cmd=(codex --dangerously-bypass-approvals-and-sandbox)
      if [[ "$mode" == "resume" ]]; then
        cmd+=(resume --last)
      elif [[ -n "${INITIAL_CMD:-}" ]]; then
        cmd+=("${INITIAL_CMD}")
      fi
      cd /workspace
      "${cmd[@]}"
      ;;
    gemini)
      if ! command -v gemini >/dev/null 2>&1; then
        echo "[agent] gemini CLI not installed in this image. Install with: sudo npm install -g @google/gemini-cli"
        exec bash -l
      fi
      local -a cmd=(gemini --yolo)
      if [[ "$mode" == "resume" ]]; then
        cmd+=(--resume latest)
      elif [[ -n "${INITIAL_CMD:-}" ]]; then
        cmd+=("${INITIAL_CMD}")
      fi
      cd /workspace
      "${cmd[@]}"
      ;;
    copilot)
      if ! command -v copilot >/dev/null 2>&1; then
        echo "[agent] copilot CLI not installed in this image. Install with: sudo npm install -g @github/copilot"
        exec bash -l
      fi
      local -a cmd=(copilot --yolo)
      if [[ "$mode" == "resume" ]]; then
        cmd+=(--continue)
      elif [[ -n "${INITIAL_CMD:-}" ]]; then
        cmd+=(-i "${INITIAL_CMD}")
      fi
      cd /workspace
      "${cmd[@]}"
      ;;
    *)
      cd /workspace
      exec bash -l
      ;;
  esac
}

restart_count=0
mode="start"

write_status "running" "$restart_count"
echo "[supervisor] starting $AGENT_KIND in /workspace"

while true; do
  if run_agent "$mode"; then
    exit_code=0
  else
    exit_code=$?
  fi

  restart_count=$((restart_count + 1))
  exited_at="$(iso_now)"
  reason="Agent process exited with code ${exit_code}; restarting in resume mode."

  write_status "restarting" "$restart_count" "$exit_code" "$exited_at" "$exited_at" "$reason"
  echo
  echo "[supervisor] ${reason}"
  echo "[supervisor] reconnecting to the most recent conversation in ${RESTART_DELAY_SECONDS}s..."
  sleep "$RESTART_DELAY_SECONDS"

  mode="resume"
  write_status "running" "$restart_count" "$exit_code" "$exited_at" "$exited_at" "$reason"
done
