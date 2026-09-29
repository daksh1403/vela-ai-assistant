FROM node:22-alpine AS builder
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
RUN npm run build

FROM caddy:2.10.0-alpine
COPY --from=builder /web/dist /srv
COPY infra/Caddyfile.local /etc/caddy/Caddyfile
