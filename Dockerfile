# ---- Base stage: install dependencies ----
FROM node:20-slim AS base

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/schemas/package.json packages/schemas/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/cartridge-sdk/package.json packages/cartridge-sdk/
COPY cartridges/ads-spend/package.json cartridges/ads-spend/
COPY apps/api/package.json apps/api/
COPY apps/chat/package.json apps/chat/

RUN pnpm install --frozen-lockfile

# ---- Build stage: compile TypeScript ----
FROM base AS build

COPY . .
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

COPY --from=build /app/cartridges/ads-spend/package.json cartridges/ads-spend/package.json
COPY --from=build /app/cartridges/ads-spend/dist/ cartridges/ads-spend/dist/

COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist/ apps/api/dist/

RUN pnpm install --frozen-lockfile --prod

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

COPY --from=build /app/packages/cartridge-sdk/package.json packages/cartridge-sdk/package.json
COPY --from=build /app/packages/cartridge-sdk/dist/ packages/cartridge-sdk/dist/

COPY --from=build /app/cartridges/ads-spend/package.json cartridges/ads-spend/package.json
COPY --from=build /app/cartridges/ads-spend/dist/ cartridges/ads-spend/dist/

COPY --from=build /app/apps/chat/package.json apps/chat/package.json
COPY --from=build /app/apps/chat/dist/ apps/chat/dist/

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "apps/chat/dist/main.js"]
