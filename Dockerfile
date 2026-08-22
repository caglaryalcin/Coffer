# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-bookworm-slim

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS dependencies
WORKDIR /app

ENV CI=true

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --no-audit --no-fund

FROM dependencies AS builder
WORKDIR /app

ENV NODE_ENV=production

COPY . .
RUN npm run build
RUN node scripts/assert-portable-runtime.mjs \
      /app/dist/standalone /app/node_modules/react && \
    install -d -m 0755 /runtime-data

FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Keep target-platform stages command-free: the portable JS/WASM build is
# produced once on BUILDPLATFORM, then linked onto each native Node base image.
COPY --link --from=builder --chown=1000:1000 /runtime-data/ ./data/
COPY --link --from=builder --chown=1000:1000 /app/dist/standalone/dist ./dist
COPY --link --from=builder --chown=1000:1000 /app/dist/standalone/node_modules ./node_modules
COPY --link --from=builder --chown=1000:1000 /app/dist/standalone/server.js /app/dist/standalone/package.json ./
# Vinext's standalone output omits its React peer dependency.
COPY --link --from=builder --chown=1000:1000 /app/node_modules/react ./node_modules/react
COPY --link --from=builder --chown=1000:1000 /app/LICENSE ./

USER 1000:1000

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/', { redirect: 'manual' }).then((response) => { if (response.status >= 400) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
