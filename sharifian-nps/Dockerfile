# syntax=docker/dockerfile:1
# One image for Liara and any VPS (D10, D90). Node 22 runs the TypeScript server directly; the build stage
# only makes the browser bundles. Everything that must survive a redeploy lives on the /data volume:
# the SQLite database and its automatic daily backups.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# A domestic npm mirror can be passed with: --build-arg NPM_REGISTRY=https://…
ARG NPM_REGISTRY=https://registry.npmjs.org/
# .npmrc turns install scripts off: better-sqlite3 ships ready binaries, so nothing is compiled (D91).
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund --registry="$NPM_REGISTRY"
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# sqlite3 CLI for scripts/backup.sh and for looking inside the database by hand. Optional (D91): if the build
# server cannot reach the Debian mirror the image is still built; the app's own daily backups need no CLI.
RUN (apt-get update && apt-get install -y --no-install-recommends sqlite3) \
 || echo "warning: sqlite3 CLI not installed; run scripts/backup.sh on the host instead"; \
 rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/nps.db
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/config ./config
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
# A checkout on Windows may give the shell scripts CRLF line endings, which sh cannot run.
RUN sed -i 's/\r$//' scripts/*.sh && mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Starts as root only to make /data writable, then runs the app as the unprivileged "node" user.
ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "src/server.ts"]
