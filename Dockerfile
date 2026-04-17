# ---- Base stage: install dependencies ----
FROM node:20-slim AS base

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy dependency manifests first (optimizes Docker layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/cartridge-sdk/package.json packages/cartridge-sdk/
COPY apps/api/package.json apps/api/
COPY apps/chat/package.json apps/chat/
COPY apps/mcp-server/package.json apps/mcp-server/
COPY apps/dashboard/package.json apps/dashboard/

RUN pnpm install --frozen-lockfile

# ---- Build stage: compile TypeScript ----
FROM base AS build

COPY . .
RUN pnpm db:generate
RUN pnpm build

# ---- Production stage: API server ----
FROM node:20-slim AS api

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json /app/turbo.json ./

COPY --from=build /app/packages/schemas/package.json packages/schemas/package.json
COPY --from=build /app/packages/schemas/dist/ packages/schemas/dist/

COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist/ packages/core/dist/

COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/db/dist/ packages/db/dist/
COPY --from=build /app/packages/db/prisma/ packages/db/prisma/

COPY --from=build /app/packages/cartridge-sdk/package.json packages/cartridge-sdk/package.json
COPY --from=build /app/packages/cartridge-sdk/dist/ packages/cartridge-sdk/dist/

COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist/ apps/api/dist/

RUN pnpm install --frozen-lockfile --prod

USER node

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "apps/api/dist/server.js"]

# ---- Production stage: Chat server ----
FROM node:20-slim AS chat

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json /app/turbo.json ./

COPY --from=build /app/packages/schemas/package.json packages/schemas/package.json
COPY --from=build /app/packages/schemas/dist/ packages/schemas/dist/

COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist/ packages/core/dist/

COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/db/dist/ packages/db/dist/
COPY --from=build /app/packages/db/prisma/ packages/db/prisma/

COPY --from=build /app/packages/cartridge-sdk/package.json packages/cartridge-sdk/package.json
COPY --from=build /app/packages/cartridge-sdk/dist/ packages/cartridge-sdk/dist/

COPY --from=build /app/apps/chat/package.json apps/chat/package.json
COPY --from=build /app/apps/chat/dist/ apps/chat/dist/

RUN pnpm install --frozen-lockfile --prod

USER node

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "apps/chat/dist/main.js"]

# ---- Production stage: Dashboard (Next.js standalone) ----
FROM node:20-slim AS dashboard

WORKDIR /app

COPY --from=build /app/apps/dashboard/.next/standalone ./
COPY --from=build /app/apps/dashboard/.next/static apps/dashboard/.next/static
COPY --from=build /app/apps/dashboard/public apps/dashboard/public

USER node

EXPOSE 3002
ENV NODE_ENV=production
ENV PORT=3002
CMD ["node", "apps/dashboard/server.js"]

# ---- Production stage: MCP server ----
FROM node:20-slim AS mcp-server

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json /app/turbo.json ./

COPY --from=build /app/packages/schemas/package.json packages/schemas/package.json
COPY --from=build /app/packages/schemas/dist/ packages/schemas/dist/

COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist/ packages/core/dist/

COPY --from=build /app/packages/cartridge-sdk/package.json packages/cartridge-sdk/package.json
COPY --from=build /app/packages/cartridge-sdk/dist/ packages/cartridge-sdk/dist/

COPY --from=build /app/apps/mcp-server/package.json apps/mcp-server/package.json
COPY --from=build /app/apps/mcp-server/dist/ apps/mcp-server/dist/

RUN pnpm install --frozen-lockfile --prod

USER node

ENV NODE_ENV=production
CMD ["node", "apps/mcp-server/dist/main.js"]
