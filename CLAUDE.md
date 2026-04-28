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

## Branch & Worktree Doctrine

- **Specs and plans land on `main` via focused PRs**, not on feature branches. A `docs/superpowers/specs/*` or `docs/superpowers/plans/*` change should be its own small PR to `main`. Implementation branches **consume** specs that already live on `main` — they do not accumulate planning docs for unrelated workstreams.
- **One branch per worktree.** Never check out a long-lived branch in two worktrees.
- **Worktrees have a teardown step.** When the underlying branch merges or is deleted, remove the worktree the same day: `git worktree remove <path> && git worktree prune`.
- **Before every commit, verify branch context.** Run `git branch --show-current` and `git status --short` to confirm the active branch matches the work, especially in agent sessions where the active branch may not match assumptions.
- A pre-commit hook (`scripts/check-branch-relevance.sh`) warns when a docs-only commit references a different feature than the active branch's slug. The hook is non-blocking: warnings are signals, not gates.

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
Layer 3: core                → schemas + cartridge-sdk + sdk (NOT db, creative-pipeline, ad-optimizer)
Layer 4: db                  → schemas + core (NOT cartridge-sdk)
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
pnpm reset                        # Clean + regenerate Prisma + rebuild schemas/db/core
```

If `pnpm typecheck` reports missing exports from `@switchboard/schemas`, `@switchboard/db`, or `@switchboard/core` — or unknown Prisma fields like `entitlementOverride` — run `pnpm reset` first. Stale generated artifacts (Prisma client, dist outputs) cause false-alarm "main is broken" diagnostics. `pnpm reset` is the canonical clean rebuild.

## Code Basics

- ESM only, `.js` extensions in relative imports (except Next.js)
- Unused variables prefixed with `_`
- No `console.log` — use `console.warn` or `console.error`
- No `any` — use proper types or `unknown`
- Prettier: semi, double quotes, 2-space indent, trailing commas, 100 char width
- Conventional Commits enforced by commitlint
- Every new module must include co-located tests (`*.test.ts`)
- Run `pnpm test` and `pnpm typecheck` before committing
- Schema changes require a migration in the same commit. Run `pnpm db:check-drift` before committing schema changes (requires a running PostgreSQL).
- File size: error at 600 lines, warn at 400 — split proactively
- Coverage: global 55/50/52/55, core 65/65/70/65
- Barrel files: flag if >40 exported symbols
- No premature abstractions — check existing utils first; >3 new files needs justification

## Environment Variables

See `.env.example`. Never commit `.env` files or secrets.
