FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.scripts.json tsup.config.ts ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    WGE_RUNTIME_ROOT=/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && mkdir -p /data \
    && chown -R node:node /app /data

COPY --from=build --chown=node:node /app/dist ./dist

USER node
VOLUME ["/data"]

ENTRYPOINT ["node", "dist/index.js", "--runtime-root", "/data"]
CMD ["status"]
