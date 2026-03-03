# Switchboard — Project Rules for Claude Code

## Architecture

Switchboard is a TypeScript monorepo using pnpm workspaces. The dependency layers are strictly ordered — **NEVER VIOLATE** these import rules:

```
schemas        → no @switchboard/* imports (leaf package)
cartridge-sdk  → may import @switchboard/schemas only
core           → may import @switchboard/schemas, @switchboard/cartridge-sdk
db             → may import @switchboard/schemas, @switchboard/core (NEVER cartridge imports)
apps/*         → may import any @switchboard/* package; may read skins/
cartridges/*   → may import @switchboard/schemas, @switchboard/cartridge-sdk, @switchboard/core (NEVER db or apps)
skins/         → pure JSON data; not a package; not importable
```

Circular dependencies between packages are **forbidden**.

### Package Layout

```
packages/schemas         — Zod schemas, shared types (incl. SkinManifest, CRM provider types)
packages/cartridge-sdk   — Cartridge interface & base classes
packages/core            — Orchestrator, policy engine, ToolRegistry, SkinLoader/Resolver
packages/db              — Prisma client, store implementations
apps/api                 — Fastify REST API server
apps/chat                — Chat/webhook server (Telegram, Slack, WhatsApp)
apps/dashboard           — Next.js admin dashboard
apps/mcp-server          — MCP protocol server
cartridges/*             — Domain-specific cartridge implementations
skins/                   — Vertical deployment manifests (JSON, loaded at boot via SKIN_ID)
```

## Build / Test / Lint Commands

```bash
pnpm build              # Build all packages (Turbo)
pnpm lint               # Lint all packages
pnpm test               # Run all tests
pnpm test -- --coverage # Run tests with coverage report
pnpm typecheck           # TypeScript type checking
pnpm format:check        # Check Prettier formatting

# Run a single package's tests
pnpm --filter @switchboard/core test

# Database
pnpm db:generate         # Generate Prisma client
pnpm db:migrate          # Run migrations
pnpm db:seed             # Seed database
```

## Code Conventions

- **ESM only** — all packages use ES modules with `"type": "module"`
- **`.js` extensions** — use `.js` extensions in relative imports (TypeScript resolves them)
- **Unused variables** — prefix with `_` (e.g., `_unused`); the linter enforces this
- **No `console.log`** — use `console.warn` or `console.error` (or a logger). `no-console` rule is active
- **No `any`** — avoid `@typescript-eslint/no-explicit-any`; use proper types or `unknown`
- **Prettier** — formatting is enforced (semi, double quotes, 2-space indent, trailing commas, 100 char width)

## Testing Requirements

- Every new module or feature **must** include tests
- Run `pnpm test` and `pnpm typecheck` before committing
- Global coverage thresholds: statements 60%, branches 50%, functions 55%, lines 60%
- **Sensitive packages have elevated thresholds** (per-package `vitest.config.ts`):
  - `packages/core`: 65/65/70/65 (statements/branches/functions/lines)
  - `cartridges/payments`: 70/70/75/70 (target: 80/70/75/80)
  - `cartridges/patient-engagement`: 60/60/70/60 (target: 80/70/75/80)
- Test files use the pattern `*.test.ts` and are co-located with source files

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add webhook retry logic
fix: handle null provider response
chore: update dependencies
docs: clarify API authentication flow
refactor: extract validation into shared util
test: add coverage for orchestrator edge cases
```

The commit message is validated by commitlint on every commit. Non-conforming messages are **rejected**.

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable                                | Purpose                                |
| --------------------------------------- | -------------------------------------- |
| `DATABASE_URL`                          | PostgreSQL connection string           |
| `REDIS_URL`                             | Redis for rate limiting, queues        |
| `PORT` / `CHAT_PORT` / `DASHBOARD_PORT` | Server ports (3000 / 3001 / 3002)      |
| `API_KEYS`                              | Comma-separated API keys for auth      |
| `API_KEY_ENCRYPTION_SECRET`             | Encryption secret for stored API keys  |
| `NEXTAUTH_SECRET`                       | NextAuth session secret                |
| `CREDENTIALS_ENCRYPTION_KEY`            | Encrypt stored third-party credentials |
| `SKIN_ID`                               | Vertical skin to load (e.g. `clinic`)  |

Never commit `.env` files or secrets to the repository.

## Pre-Commit Hooks

Husky runs these hooks automatically:

- **pre-commit**: lint-staged (ESLint fix + Prettier format on staged files)
- **commit-msg**: commitlint (validates conventional commit format)

## Branch Protection

`main` branch is protected via GitHub API:

- **Required status checks**: typecheck, lint, test, security (must pass before merge)
- **Strict mode**: branches must be up-to-date with `main` before merging
- **PRs required**: direct pushes to `main` are blocked
- **Enforced for admins**: no bypass, even for repo owners

## Security Scanning

- **Gitleaks**: scans git history for hardcoded secrets (API keys, tokens, passwords) in CI
- **CodeQL**: weekly SAST scanning for OWASP Top 10 vulnerabilities (SQL injection, XSS, etc.)
- **pnpm audit**: dependency CVE scanning on every CI run
- **CODEOWNERS**: `.github/CODEOWNERS` defines ownership for sensitive paths
