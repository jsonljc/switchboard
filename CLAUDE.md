# Switchboard — Claude Code Instructions

Governed operating system for revenue actions (TypeScript monorepo, pnpm + Turborepo).

For architectural rules: `docs/DOCTRINE.md`
For deep architecture: `docs/ARCHITECTURE.md`

## Agent Operating Layer

Before architecture work, audits, or implementation planning:

1. Read `.agent/RESOLVER.md` to identify task type.
2. Load only the files the resolver specifies.
3. Use deterministic tools before reasoning manually.
4. Keep context lean. Do not load unrelated files.

`.agent/` is a build layer for AI agents. It is not product code, not loaded by the app, and does not replace the product `skills/` directory.

## Core Invariants

- Mutating actions enter through `PlatformIngress.submit()`.
- `WorkTrace` is canonical persistence.
- Approval is lifecycle state, not a route-owned side effect.
- Tools are audited, idempotent product surfaces.
- Human escalation is first-class architecture.
- No mutating bypass paths.

## Codebase Map

```
packages/schemas/            — Zod schemas & shared types (no internal deps)
packages/sdk/                — Agent manifest, handler interface, test harness
packages/cartridge-sdk/      — Legacy cartridge interface (pending removal)
packages/creative-pipeline/  — Creative content pipeline (async jobs via Inngest)
packages/ad-optimizer/       — Ad platform integration + optimization
packages/core/               — Platform ingress, governance, skill runtime, orchestration
packages/db/                 — Prisma ORM, store implementations, credential encryption

apps/api/          — Fastify REST API (port 3000)
apps/chat/         — Multi-channel chat — Telegram, WhatsApp, Slack (port 3001)
apps/dashboard/    — Next.js UI + operator controls (port 3002)
apps/mcp-server/   — MCP server for LLM tool use
```

## Dependency Layers

```
Layer 1: schemas             → No @switchboard/* imports
Layer 2: cartridge-sdk, sdk, creative-pipeline, ad-optimizer → schemas only
Layer 3: core                → schemas + cartridge-sdk + sdk
Layer 4: db                  → schemas + core
Layer 5: apps/*              → May import anything
```

Circular dependencies are forbidden.

## Build / Test / Lint

```bash
pnpm build                        # Build all (Turbo)
pnpm lint                         # Lint all
pnpm test                         # Run all tests
pnpm typecheck                    # TypeScript type checking
pnpm --filter @switchboard/core test  # Single package
pnpm db:generate                  # Generate Prisma client
pnpm db:migrate                   # Run migrations
```

## Code Basics

- ESM only, `.js` extensions in relative imports (except Next.js)
- Unused variables prefixed with `_`
- No `console.log` — use `console.warn` or `console.error`
- No `any` — use proper types or `unknown`
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100 char width
- Conventional Commits enforced by commitlint
- Every new module must include co-located tests (`*.test.ts`)
- Run `pnpm test` and `pnpm typecheck` before committing

## Environment Variables

See `.env.example`. Never commit `.env` files or secrets.
