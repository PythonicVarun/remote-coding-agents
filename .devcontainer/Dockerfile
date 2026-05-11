FROM mcr.microsoft.com/devcontainers/base:ubuntu24.04

# Install core tools, Python, and ttyd
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    python3-pip \
    ttyd \
    && rm -rf /var/lib/apt/lists/*

# Set the default working directory
WORKDIR /workspace
