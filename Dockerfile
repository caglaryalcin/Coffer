# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS dependencies
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

FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

RUN mkdir -p /app/data && chown 1000:1000 /app/data

COPY --from=builder --chown=1000:1000 /app/dist/standalone/ ./
# Vinext's standalone output omits its React peer dependency.
COPY --from=builder --chown=1000:1000 /app/node_modules/react ./node_modules/react

USER 1000:1000

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/', { redirect: 'manual' }).then((response) => { if (response.status >= 400) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
