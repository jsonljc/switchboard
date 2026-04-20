# Switchboard — Claude Code Instructions

> **Context layers:** This file is organised into five layers. L1 is stable
> doctrine loaded every session. L2–L5 are conventions applied per task.
> See `CLAUDE.local.md` for personal wiki pointers and memory file paths.

---

## L1: Doctrine

> Stable. Loaded every session. Everything below this heading is L1.

Governed operating system for revenue actions (TypeScript monorepo, pnpm + Turborepo). For architectural rules see `docs/DOCTRINE.md`. For deep architecture details see `docs/ARCHITECTURE.md`.

---

## Codebase Map

```
packages/schemas/            — Zod schemas & shared types (no internal deps)
packages/sdk/                — Agent manifest, handler interface, test harness
packages/cartridge-sdk/      — Legacy cartridge interface (pending removal — see docs/DOCTRINE.md)
packages/creative-pipeline/  — Creative content pipeline (async jobs via Inngest)
packages/ad-optimizer/       — Ad platform integration + optimization
packages/core/               — Platform ingress, governance, skill runtime, orchestration
packages/db/                 — Prisma ORM, store implementations, credential encryption

apps/api/          — Fastify REST API — platform ingress + governance endpoints (port 3000)
apps/chat/         — Multi-channel chat — Telegram, WhatsApp, Slack (port 3001)
apps/dashboard/    — Next.js marketplace UI + operator controls (port 3002)
apps/mcp-server/   — MCP server for LLM tool use
```

### Dependency Layers (enforced by ESLint + dependency-cruiser)

```
Layer 1: schemas             → No @switchboard/* imports
Layer 2: cartridge-sdk       → schemas only
Layer 2: sdk                 → schemas only
Layer 2: creative-pipeline   → schemas only
Layer 2: ad-optimizer        → schemas only
Layer 3: core                → schemas + cartridge-sdk + sdk (NOT db, creative-pipeline, ad-optimizer)
Layer 4: db                  → schemas + core (NOT cartridge-sdk)
Layer 5: apps/*              → May import anything
```

Circular dependencies are forbidden and enforced in CI.

---

## Build / Test / Lint

```bash
pnpm build                        # Build all (Turbo)
pnpm lint                         # Lint all
pnpm test                         # Run all tests
pnpm test -- --coverage           # Tests with coverage
pnpm typecheck                    # TypeScript type checking
pnpm format:check                 # Check Prettier formatting
pnpm --filter @switchboard/core test  # Single package tests
pnpm db:generate                  # Generate Prisma client
pnpm db:migrate                   # Run migrations
pnpm db:seed                      # Seed database
```

---

## Code Conventions

- **ESM only** — `"type": "module"` everywhere
- **`.js` extensions** in relative imports (TypeScript resolves them)
- **Unused variables** — prefix with `_` (enforced by linter)
- **No `console.log`** — use `console.warn` or `console.error`
- **No `any`** — use proper types or `unknown`
- **Prettier** — semi, double quotes, 2-space indent, trailing commas, 100 char width

---

## Testing

- Every new module **must** include tests (`*.test.ts`, co-located with source)
- Run `pnpm test` and `pnpm typecheck` before committing
- Global thresholds: statements 55%, branches 50%, functions 52%, lines 55%
- Elevated thresholds (per-package `vitest.config.ts`):
  - `core`: 65/65/70/65

---

## Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint:

```
feat: add webhook retry logic
fix: handle null provider response
chore: update dependencies
```

---

## Architecture Enforcement

### File Size

- **Error at 600 lines** (excluding blanks/comments) — blocks commits
- **Warn at 400 lines** — split proactively
- Existing oversized files have `/* eslint-disable max-lines */` — don't add code without splitting first

### New Module Checklist

- Corresponding `__tests__/<name>.test.ts` test file
- Proper layer placement
- No `any`, `.js` extensions on all relative imports

### Cartridges (Legacy)

Cartridges are a retired concept. No cartridge implementations exist. `CartridgeMode` remains as a legacy execution bridge. Do not create new cartridges. See `docs/DOCTRINE.md` for canonical vocabulary.

### Refactoring Principles

- No premature abstractions — check `sdk`, `core`, `schemas` for existing utils first
- No grab-bag `utils.ts` — every file has a single clear responsibility
- If a refactor creates >3 new files, justify why

### Platform Ingress Boundary

All governed work enters through `PlatformIngress.submit()`. App-layer code must not call orchestrator methods directly for work submission. Enforced by static analysis test (`apps/api/src/__tests__/ingress-boundary.test.ts`).

Remaining legacy orchestrator calls (approval response, undo, simulate, emergency halt) are tracked in `docs/DOCTRINE.md` Legacy Bridge Registry with explicit exit conditions.

### Barrel Files

- Flag if an `index.ts` exceeds 40 exported symbols
- Prefer selective re-exports over `export *`

---

## Pre-Commit & CI

**Pre-commit (Husky):** lint-staged (ESLint + Prettier) + commitlint

**CI (8 parallel jobs):** typecheck, lint, test (with coverage), secrets (gitleaks), security (pnpm audit), architecture (dependency-cruiser), docker build

**Branch protection:** PRs required, all status checks must pass, enforced for admins. No direct pushes to `main`.

---

## Environment Variables

See `.env.example` for the full list. Never commit `.env` files or secrets.

---

## L2: Project Memory

Pointers only — no content dumps. Load the relevant slice for the current task.

- Active decisions and blockers: see `CLAUDE.local.md` → Memory Files section
- Wiki pages by task type: see `CLAUDE.local.md` → Wiki Context by Task Type
- Reusable procedures: test scaffold = co-locate `__tests__/<name>.test.ts`; migration = `pnpm db:migrate`; PR review = typecheck + lint + test + coverage

---

## L3: Task Capsule Format

Use this structure for all subagent dispatches. Replace prose briefings.

```json
{
  "goal": "",
  "scope": [],
  "constraints": [],
  "expected_deliverable": "",
  "open_questions": []
}
```

---

## L4: Tool Gating

- Read tools first. Confirm scope before using write tools.
- Never import from `@switchboard/db` or `apps/*` in `schemas`, `core`, or `cartridge-sdk` tasks.
- Prefer targeted file reads (`Read packages/core/src/model-router.ts`) over directory dumps.
- Only expose dashboard/db tools for app-layer tasks (Layer 6 in the dependency stack).

---

## L5: Write-Back

After each meaningful session:

1. Update relevant memory files (`~/.claude/projects/.../memory/`)
2. Append to `~/second brain/06_KNOWLEDGE/wiki/log.md` if a new insight was produced
3. Note any reusable pattern discovered
4. Record decisions made (what and why, not just what)
