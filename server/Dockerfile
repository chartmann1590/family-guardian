FROM node:26-alpine AS base
RUN apk add --no-cache python3 make g++ libstdc++
WORKDIR /app

FROM base AS deps
COPY package.json ./
RUN npm install --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/guardian.db
ENV HOST=0.0.0.0
ENV PORT=8080
RUN mkdir -p /data && chown node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node src ./src
COPY --chown=node:node package.json ./
COPY --chown=node:node downloads ./downloads
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "src/index.js"]
