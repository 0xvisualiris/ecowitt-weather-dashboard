# ---------- 1) Frontend bauen ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 2) Server-Abhängigkeiten ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------- 3) Laufzeit-Image ----------
FROM node:22-alpine
RUN apk add --no-cache tzdata bzip2
ENV NODE_ENV=production \
    PORT=47813 \
    CONFIG_PATH=/config/config.yaml \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=web /web/dist ./public
COPY config/config.example.yaml ./config.example.yaml
RUN mkdir -p /config /data && chown -R node:node /data
USER node
EXPOSE 47813
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "src/index.js"]
