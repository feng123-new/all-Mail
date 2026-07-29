FROM node:20-bookworm-slim AS web-builder
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.23-bookworm AS go-builder
WORKDIR /src/core
COPY core/go.mod core/go.sum ./
RUN go mod download
COPY core ./
RUN test -z "$(gofmt -l .)" \
    && go test ./... \
    && go vet ./... \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/allmail ./cmd/allmail

FROM debian:bookworm-slim AS runtime
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 allmail \
    && useradd --system --uid 10001 --gid allmail --home-dir /var/lib/all-mail --shell /usr/sbin/nologin allmail \
    && mkdir -p /app/public /app/migrations /var/lib/all-mail \
    && chown -R allmail:allmail /app /var/lib/all-mail

ENV ALL_MAIL_STATIC_DIR=/app/public \
    ALL_MAIL_STATE_DIR=/var/lib/all-mail \
    ALL_MAIL_MIGRATION_DIR=/app/migrations \
    PORT=3000

COPY --from=go-builder /out/allmail /usr/local/bin/allmail
COPY --from=web-builder /src/web/dist /app/public
COPY core/migrations /app/migrations

USER allmail:allmail
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/allmail"]
CMD ["api"]
