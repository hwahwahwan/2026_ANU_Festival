# syntax=docker/dockerfile:1
# Lockfile build tools require Node ^22.22.3 (or a supported newer major).
ARG NODE_IMAGE=node:22.23-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
# argon2 can fall back to a native ARM64 build when a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --engine-strict

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Explicit, one-off maintenance only; never part of application startup.
FROM dependencies AS tools
COPY tsconfig.json ./
COPY database ./database
USER node
CMD ["node", "--version"]

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
