#!/usr/bin/env bash
# Entrypoint for the agent container.
#
# Env contract (set by the backend when creating the container):
#   AGENT_KIND   = "claude" | "codex" | "gemini" | "copilot" | "shell"
#                  (default: shell)
#   TTYD_PORT    = port ttyd binds inside the container (default: 7681)
#   TTYD_AUTH    = "user:pass" for ttyd basic auth (optional)
#   INITIAL_CMD  = optional command to execute in the spawned shell
#   RCA_AGENT_START_MODE = "start" | "resume" for agent CLIs (default: start)
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

# Seed Claude Code defaults into the agent home on first use:
#   • Skill folders → $HOME/.claude/skills/<name>/SKILL.md  (Claude scans this dir)
#   • MCP servers   → merged into $HOME/.claude.json  (top-level "mcpServers" key)
#
# Existing files/entries are never overwritten so user edits persist.
# Skills/servers gated on LLMFOUNDRY_TOKEN (currently: "ocr") are only seeded
# when that token is present — otherwise the model is never told about a tool
# whose backend it can't actually reach.
if [[ -d "/etc/rca-defaults" ]]; then
  mkdir -p "$HOME/.claude/skills"
  _llmfoundry_available="${LLMFOUNDRY_TOKEN:+yes}"

  # ---- Skills ---------------------------------------------------------------
  # Each subdir of defaults/.claude/skills/ is a skill (folder with SKILL.md).
  if [[ -d "/etc/rca-defaults/.claude/skills" ]]; then
    for src_dir in /etc/rca-defaults/.claude/skills/*/; do
      [[ -d "$src_dir" ]] || continue
      skill_name="$(basename "$src_dir")"
      if [[ "$skill_name" == "ocr" && -z "$_llmfoundry_available" ]]; then
        continue
      fi
      dst_dir="$HOME/.claude/skills/$skill_name"
      [[ -e "$dst_dir" ]] || cp -r "$src_dir" "$dst_dir"
    done
  fi

  # ---- Agent instructions (CLAUDE.md auto-loaded as user-level memory) ------
  # Only seed when LLMFOUNDRY_TOKEN is available — the file is OCR-centric and
  # mentioning a tool the model can't actually call is worse than silence.
  if [[ -n "$_llmfoundry_available" && -f "/etc/rca-defaults/.claude/CLAUDE.md" ]]; then
    [[ -f "$HOME/.claude/CLAUDE.md" ]] || cp "/etc/rca-defaults/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  fi

  # ---- MCP servers (merged into ~/.claude.json) -----------------------------
  default_claude_json="/etc/rca-defaults/.claude.json"
  if [[ -f "$default_claude_json" ]]; then
    target_claude_json="$HOME/.claude.json"
    python3 - "$default_claude_json" "$target_claude_json" "$_llmfoundry_available" <<'PY'
import json, sys, os
defaults_path, target_path, llmfoundry_flag = sys.argv[1], sys.argv[2], sys.argv[3]

with open(defaults_path) as f:
    defaults = json.load(f)

if os.path.exists(target_path):
    try:
        with open(target_path) as f:
            target = json.load(f)
    except Exception:
        target = {}
else:
    target = {}

servers = target.setdefault("mcpServers", {})
changed = False
for name, cfg in defaults.get("mcpServers", {}).items():
    if name == "ocr" and not llmfoundry_flag:
        continue
    if name not in servers:
        servers[name] = cfg
        changed = True

if changed or not os.path.exists(target_path):
    with open(target_path, "w") as f:
        json.dump(target, f, indent=2)
PY
  fi
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

# xterm.js theme matches the website palette (graphite + restrained blue accent).
# Colors: bg #0b1114, fg #e8eef2, accent #2f7cf6, success #31c48d,
# warning #f2b84b, danger #f36d6d, border-strong #40535f.
TTYD_THEME='{"background":"#0b1114","foreground":"#e8eef2","cursor":"#2f7cf6","cursorAccent":"#0b1114","selectionBackground":"#12233f","selectionForeground":"#f7fafc","black":"#10181d","red":"#f36d6d","green":"#31c48d","yellow":"#f2b84b","blue":"#2f7cf6","magenta":"#b58bf6","cyan":"#5cbfb8","white":"#a5b2bc","brightBlack":"#40535f","brightRed":"#ff8b8b","brightGreen":"#5ed3a8","brightYellow":"#ffc966","brightBlue":"#5a98f7","brightMagenta":"#d5acff","brightCyan":"#7fd9d2","brightWhite":"#e8eef2"}'

TTYD_ARGS=(
  --writable
  --port "$TTYD_PORT"
  --interface 0.0.0.0
  --max-clients 4
  --terminal-type xterm-256color
  -t "fontFamily=JetBrains Mono, Cascadia Code, Consolas, Menlo, monospace"
  -t fontSize=13
  -t cursorStyle=bar
  -t cursorBlink=true
  -t disableLeaveAlert=true
  -t "theme=${TTYD_THEME}"
)
if [[ -n "${TTYD_AUTH:-}" ]]; then
  TTYD_ARGS+=(--credential "$TTYD_AUTH")
fi

echo "[entrypoint] launching ttyd attached to tmux session '$TMUX_SESSION'"
exec ttyd "${TTYD_ARGS[@]}" -- tmux attach -t "$TMUX_SESSION"
