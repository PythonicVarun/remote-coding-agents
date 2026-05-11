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

# Claude Code CLI — optional but useful default
RUN npm install -g @anthropic-ai/claude-code || \
    echo "warning: claude-code install failed at build time; can be installed at runtime"

# Non-root user with passwordless sudo
RUN useradd -m -s /bin/bash -u 1000 agent \
    && echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent

# Entrypoint script handles agent-kind selection
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER agent
WORKDIR /workspace

# Default shell setup
RUN mkdir -p /home/agent/.config \
    && echo 'export PS1="\[\e[36m\]agent\[\e[0m\]:\w\$ "' >> /home/agent/.bashrc \
    && echo 'cd /workspace 2>/dev/null || true' >> /home/agent/.bashrc

EXPOSE 7681

# tini reaps zombies from ttyd-spawned shells
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
