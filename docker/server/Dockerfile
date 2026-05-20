# syntax=docker/dockerfile:1.6
#
# Image for the remote-coding-agents backend (Express + Socket.IO) with the
# built React client baked in. Designed to run via docker compose alongside a
# mounted host docker socket so it can spawn sibling agent containers.

# Stage 1 — build server (tsc) and client (vite build)
FROM node:20-bookworm AS builder
WORKDIR /app

# Install deps using just the manifests so npm can resolve workspace links.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspaces --include-workspace-root

# Build both workspaces.
COPY . .
RUN npm run build

# Drop dev dependencies from the install to slim the runtime image.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# Stage 2 — runtime
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Copy the pruned workspace (node_modules + server/dist + client/dist + manifests).
COPY --from=builder /app /app

EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
