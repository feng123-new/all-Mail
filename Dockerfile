FROM node:24-bookworm-slim AS web-builder
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26.5-bookworm AS go-builder
WORKDIR /src/core
COPY core/go.mod core/go.sum ./
RUN go mod download
COPY config/route-ownership.json /src/config/route-ownership.json
COPY config/jwt-duration-vectors.json /src/config/jwt-duration-vectors.json
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
    && mkdir -p /app/config /app/public /app/migrations /var/lib/all-mail /var/lib/all-mail-forwarding /var/lib/all-mail-go-business \
    && chown -R allmail:allmail /app /var/lib/all-mail /var/lib/all-mail-forwarding /var/lib/all-mail-go-business

ENV ALL_MAIL_STATIC_DIR=/app/public \
    ALL_MAIL_STATE_DIR=/var/lib/all-mail \
    ALL_MAIL_MIGRATION_DIR=/app/migrations \
    ALL_MAIL_ROUTE_OWNERSHIP_FILE=/app/config/route-ownership.json \
    PORT=3000

COPY --from=go-builder /out/allmail /usr/local/bin/allmail
COPY --from=web-builder /src/web/dist /app/public
COPY core/migrations /app/migrations
COPY config/route-ownership.json /app/config/route-ownership.json

USER allmail:allmail
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/allmail"]
CMD ["api"]
