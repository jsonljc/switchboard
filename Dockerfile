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
COPY packages/create-switchboard-cartridge/package.json packages/create-switchboard-cartridge/
COPY cartridges/digital-ads/package.json cartridges/digital-ads/
COPY cartridges/crm/package.json cartridges/crm/
COPY cartridges/payments/package.json cartridges/payments/
COPY cartridges/customer-engagement/package.json cartridges/customer-engagement/
COPY cartridges/quant-trading/package.json cartridges/quant-trading/
COPY cartridges/revenue-growth/package.json cartridges/revenue-growth/
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

COPY --from=build /app/cartridges/digital-ads/package.json cartridges/digital-ads/package.json
COPY --from=build /app/cartridges/digital-ads/dist/ cartridges/digital-ads/dist/

COPY --from=build /app/cartridges/crm/package.json cartridges/crm/package.json
COPY --from=build /app/cartridges/crm/dist/ cartridges/crm/dist/

COPY --from=build /app/cartridges/payments/package.json cartridges/payments/package.json
COPY --from=build /app/cartridges/payments/dist/ cartridges/payments/dist/

COPY --from=build /app/cartridges/customer-engagement/package.json cartridges/customer-engagement/package.json
COPY --from=build /app/cartridges/customer-engagement/dist/ cartridges/customer-engagement/dist/

COPY --from=build /app/cartridges/quant-trading/package.json cartridges/quant-trading/package.json
COPY --from=build /app/cartridges/quant-trading/dist/ cartridges/quant-trading/dist/

COPY --from=build /app/cartridges/revenue-growth/package.json cartridges/revenue-growth/package.json
COPY --from=build /app/cartridges/revenue-growth/dist/ cartridges/revenue-growth/dist/

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

COPY --from=build /app/cartridges/digital-ads/package.json cartridges/digital-ads/package.json
COPY --from=build /app/cartridges/digital-ads/dist/ cartridges/digital-ads/dist/

COPY --from=build /app/cartridges/crm/package.json cartridges/crm/package.json
COPY --from=build /app/cartridges/crm/dist/ cartridges/crm/dist/

COPY --from=build /app/cartridges/payments/package.json cartridges/payments/package.json
COPY --from=build /app/cartridges/payments/dist/ cartridges/payments/dist/

COPY --from=build /app/cartridges/customer-engagement/package.json cartridges/customer-engagement/package.json
COPY --from=build /app/cartridges/customer-engagement/dist/ cartridges/customer-engagement/dist/

COPY --from=build /app/cartridges/quant-trading/package.json cartridges/quant-trading/package.json
COPY --from=build /app/cartridges/quant-trading/dist/ cartridges/quant-trading/dist/

COPY --from=build /app/cartridges/revenue-growth/package.json cartridges/revenue-growth/package.json
COPY --from=build /app/cartridges/revenue-growth/dist/ cartridges/revenue-growth/dist/

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

COPY --from=build /app/cartridges/digital-ads/package.json cartridges/digital-ads/package.json
COPY --from=build /app/cartridges/digital-ads/dist/ cartridges/digital-ads/dist/

COPY --from=build /app/cartridges/crm/package.json cartridges/crm/package.json
COPY --from=build /app/cartridges/crm/dist/ cartridges/crm/dist/

COPY --from=build /app/cartridges/payments/package.json cartridges/payments/package.json
COPY --from=build /app/cartridges/payments/dist/ cartridges/payments/dist/

COPY --from=build /app/cartridges/customer-engagement/package.json cartridges/customer-engagement/package.json
COPY --from=build /app/cartridges/customer-engagement/dist/ cartridges/customer-engagement/dist/

COPY --from=build /app/cartridges/quant-trading/package.json cartridges/quant-trading/package.json
COPY --from=build /app/cartridges/quant-trading/dist/ cartridges/quant-trading/dist/

COPY --from=build /app/cartridges/revenue-growth/package.json cartridges/revenue-growth/package.json
COPY --from=build /app/cartridges/revenue-growth/dist/ cartridges/revenue-growth/dist/

COPY --from=build /app/apps/mcp-server/package.json apps/mcp-server/package.json
COPY --from=build /app/apps/mcp-server/dist/ apps/mcp-server/dist/

RUN pnpm install --frozen-lockfile --prod

USER node

ENV NODE_ENV=production
CMD ["node", "apps/mcp-server/dist/main.js"]
