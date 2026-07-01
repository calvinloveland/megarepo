FROM node:24-bookworm-slim

# Electron + xvfb runtime dependencies for headless container execution.
# This list is the Debian-12 set recommended by electron's docs for Linux.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc-s1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Bring in the rest of the source and build the TypeScript output.
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Persistent state lives outside the image so upgrades don't nuke the
# Hall of Fame or run state.
RUN mkdir -p /data/vroomon
ENV VROOMON_USER_DATA_DIR=/data/vroomon
ENV VROOMON_DISABLE_HARDWARE_ACCELERATION=1
ENV VROOMON_DISABLE_SANDBOX=1
ENV VROOMON_DISABLE_DEV_SHM_USAGE=1
ENV VROOMON_SMOKE_TEST=0

# The Electron app does not bind a TCP port, so the readiness probe
# is satisfied by the container's process being alive. Health is
# verified externally via the Cloudflare tunnel.
EXPOSE 5112

# xvfb-run provides a virtual X server; --auto-servernum avoids clashes
# when several instances of this image run side by side.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x800x24", "npx", "electron", "."]
