FROM ubuntu:26.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

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
