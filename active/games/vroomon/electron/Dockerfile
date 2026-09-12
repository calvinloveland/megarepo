FROM node:24-bookworm-slim

# The container serves the browser build via scripts/web-server.mjs (Node
# HTTP) — no desktop runtime needed. Keep the image to just what the server
# and health checks need.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Bring in the rest of the source and build the TypeScript output (tsc +
# esbuild-bundled web assets served by web-server.mjs).
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Feedback reports are written to a gitignored JSONL file in this dir; make
# it writable by the unprivileged k8s user (runAsUser 1001, fsGroup 1001).
RUN mkdir -p .secrets /data/vroomon \
    && chown -R 1001:1001 .secrets /data/vroomon

ENV VROOMON_WEB_PORT=5112
ENV VROOMON_WEB_HOST=0.0.0.0

EXPOSE 5112

CMD ["node", "scripts/web-server.mjs"]