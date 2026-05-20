# syntax=docker/dockerfile:1.6
#
# Image for a single coding-agent session.
#
# Provides:
#   - ttyd on port 7681 (exposed; mapped to a host port by the backend)
#   - bash login shell as `agent` user with sudo (passwordless) for installs
#   - Node 20 LTS, git, python3, build-essential
#   - Claude Code CLI (optional — toggled by AGENT_KIND at runtime)
#
# The host bind-mounts the project folder onto /workspace, so all writes
# the agent makes are visible to the host file watcher in real time.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_VERSION=20

# Base tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        git \
        sudo \
        gnupg \
        build-essential \
        python3 \
        python3-pip \
        python3-venv \
        tini \
        less \
        vim-tiny \
        jq \
        ripgrep \
        unzip \
        openssh-client \
        tmux \
    && rm -rf /var/lib/apt/lists/*

# Node.js (NodeSource)
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ttyd — bring up a terminal as a WebSocket
# Using prebuilt static binary so the image works on any host arch via buildx.
ARG TTYD_VERSION=1.7.7
RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in \
         amd64) TTYD_ARCH=x86_64 ;; \
         arm64) TTYD_ARCH=aarch64 ;; \
         *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
       esac \
    && curl -fsSL -o /usr/local/bin/ttyd \
        "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${TTYD_ARCH}" \
    && chmod +x /usr/local/bin/ttyd

# Coding-agent CLIs — best effort. Each install is independent so a single
# package failure doesn't block the others. Users can also install at runtime
# inside a session (the agent user has passwordless sudo).
RUN set -eu; \
    for pkg in \
        @anthropic-ai/claude-code \
        @openai/codex \
        @google/gemini-cli \
        @github/copilot ; do \
      echo ">>> installing $pkg"; \
      npm install -g --no-fund --no-audit "$pkg" \
        || echo "warning: failed to install $pkg (install at runtime if needed)"; \
    done

# Non-root user with passwordless sudo
RUN useradd -m -s /bin/bash agent \
    && echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent

# System-wide tmux config:
#   • mouse on — wheel events scroll (scrollback in shells, native scroll in
#     alt-screen TUIs like claude/codex/vim) instead of being faked as arrow
#     keys by xterm.js.
#   • set-clipboard on — tmux emits OSC 52 escape sequences on copy, which
#     xterm.js translates into a browser-clipboard write. Combined with the
#     drag-end binding below, this gives "drag to select, release to copy"
#     straight into the user's system clipboard.
#   • The explicit copy-selection-and-cancel bindings pin the behaviour so it
#     stays consistent across tmux versions (default differs between 3.2/3.3/3.4).
RUN printf '%s\n' \
    'set -g mouse on' \
    'set -g history-limit 50000' \
    'set -g set-clipboard on' \
    '' \
    '# Drag-select → release-to-copy (emits OSC 52 via set-clipboard on).' \
    'bind-key -T copy-mode    MouseDragEnd1Pane send-keys -X copy-selection-and-cancel' \
    'bind-key -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-selection-and-cancel' \
    > /etc/tmux.conf

# OCR MCP tool (stdlib only — no pip deps required)
COPY tools/ /usr/local/lib/rca-tools/
RUN chmod +x /usr/local/lib/rca-tools/ocr_server.py

# Default .claude config seeded into every new agent home on first start
COPY defaults/ /etc/rca-defaults/

# Entrypoint script handles agent-kind selection
COPY agent-supervisor.sh /usr/local/bin/agent-supervisor.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/agent-supervisor.sh /usr/local/bin/entrypoint.sh

USER agent
WORKDIR /workspace

# Default shell setup
RUN mkdir -p /home/agent/.config \
    && echo 'export PS1="\[\e[36m\]agent\[\e[0m\]:\w\$ "' >> /home/agent/.bashrc \
    && echo 'cd /workspace 2>/dev/null || true' >> /home/agent/.bashrc

EXPOSE 7681

# tini reaps zombies from ttyd-spawned shells
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]