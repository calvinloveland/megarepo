FROM node:20-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssl sqlite3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci \
  && npx prisma generate

COPY . .

RUN npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssl sqlite3 \
  && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 app \
  && adduser --system --uid 1001 --ingroup app app

COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/package-lock.json ./package-lock.json
COPY --from=build --chown=app:app /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next ./.next

USER app

EXPOSE 3000

CMD ["/bin/sh", "-ec", "if [ -n \"${DATABASE_URL:-}\" ]; then npx prisma db push --skip-generate; fi; exec npm start -- --hostname \"${HOST:-0.0.0.0}\" --port \"${PORT:-3000}\""]
