FROM node:20-bookworm-slim AS base
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

FROM base AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --include=dev

FROM base AS web-deps
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --include=dev --legacy-peer-deps

FROM base AS builder
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=web-deps /app/web/node_modules ./web/node_modules
COPY server ./server
COPY web ./web

RUN cd server && npm run db:generate
RUN cd server && npm run build
RUN cd server && npm prune --omit=dev
RUN cd web && npm run build

FROM base AS runtime
WORKDIR /app/server
ENV NODE_ENV=production

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/node_modules ./node_modules
COPY --from=builder /app/server/package*.json ./
COPY --from=builder /app/server/prisma ./prisma
COPY --from=builder /app/web/dist ../public
COPY docker/entrypoint.sh /usr/local/bin/all-mail-entrypoint
COPY scripts ../scripts

RUN chmod +x /usr/local/bin/all-mail-entrypoint

EXPOSE 3000

CMD ["all-mail-entrypoint"]
