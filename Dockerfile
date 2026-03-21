FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci

FROM node:20-alpine AS web-deps
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --legacy-peer-deps

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=web-deps /app/web/node_modules ./web/node_modules
COPY server ./server
COPY web ./web

RUN cd server && npx prisma generate
RUN cd server && npm run build
RUN cd server && npm prune --omit=dev
RUN cd web && npm run build

FROM node:20-alpine AS runtime
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
