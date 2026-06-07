# Contributing to Switchboard

Switchboard is a TypeScript monorepo (pnpm workspaces, Turborepo). The codebase is organized by dependency layer; circular dependencies are forbidden. Architectural rules live in [docs/DOCTRINE.md](docs/DOCTRINE.md).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9.x
- **PostgreSQL 17 or 18** (the schema uses the `vector` extension, which Homebrew's `pgvector` formula only ships for these versions)
- **pgvector** extension for Postgres
- Redis (optional — dedup, rate-limiting, and BullMQ fall back to in-memory if absent)

On macOS:

```bash
brew install postgresql@17 pgvector
brew services start postgresql@17
createuser -s switchboard
createdb -O switchboard switchboard
psql -d switchboard -c "ALTER USER switchboard WITH PASSWORD 'switchboard';"
```

## First-time setup

From a fresh clone:

```bash
pnpm local:setup
```

This runs: `pnpm install` → environment setup → `pnpm build` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm local:verify:fast`. Safe to re-run if any step fails.

If Postgres is not running yet, the DB-dependent steps are skipped and the command exits non-zero with a clear "setup is incomplete" message. **This is expected** — start Postgres and re-run.

The dashboard reads `apps/dashboard/.env.local`; keys marked `SYNC-FROM-ROOT` in `apps/dashboard/.env.local.example` must match the values in the root `.env` (database URL, encryption key, NextAuth secret) or auth and encryption will silently fail.

```bash
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm install
./scripts/setup-env.sh                        # generates secrets into .env AND apps/dashboard/.env.local
pnpm db:migrate                                # apply Prisma migrations
pnpm db:seed                                   # seed admin@switchboard.local / admin123
pnpm build
```

## Development

```bash
pnpm dev                                      # all services in watch mode

pnpm --filter @switchboard/api dev            # http://localhost:3000
pnpm --filter @switchboard/dashboard dev      # http://localhost:3002
pnpm --filter @switchboard/chat dev           # http://localhost:3001 (requires a channel token, see below)
```

`apps/chat` warns (and starts with no inbound channels) when none of `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, or `SLACK_BOT_TOKEN` is set in development; in production, the same condition is a hard error. Configure at least one channel token to actually receive messages.

### Watching dev readiness

In a second terminal pane after starting `pnpm dev`:

```bash
pnpm dev:ready
```

Polls `:3000/health`, `:3001/health`, and `:3002/api/dashboard/health` at 500ms intervals. Prints `:<port> ready` as each service responds and `All services ready ✓` when all three are up. Times out after 90 seconds with a recovery hint per still-unready port. Optional — useful when a slow cold-cache compile makes it ambiguous whether `pnpm dev` is still booting or actually broken.

## Working with the database

Edits to `packages/db/prisma/schema.prisma` must be paired with a migration in the same commit.

```bash
pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
git add packages/db/prisma/migrations/
```

`pnpm db:check-drift` runs the same validation locally (requires a running PostgreSQL — Prisma uses a shadow database to compare migrations against the schema). CI runs it on every PR and blocks merges when drift is detected.

## Docker

```bash
cp .env.example .env
docker compose up

# Individual targets
docker build --target api -t switchboard-api .
docker build --target chat -t switchboard-chat .
docker build --target dashboard -t switchboard-dashboard .
```

## Testing

```bash
pnpm test                                    # all tests
pnpm --filter @switchboard/core test         # core + governance
pnpm --filter @switchboard/api test          # API routes
pnpm test -- --coverage                      # with coverage
```

## API surface

All business actions enter through `PlatformIngress` and require the `Idempotency-Key` header. Endpoint documentation lives in Swagger UI at `/docs` on a running API (port 3000).

## Conventions

- Conventional Commits, enforced by commitlint (subject must start lowercase)
- Every new module ships with co-located tests (`*.test.ts`)
- Run `pnpm test`, `pnpm typecheck`, and `pnpm format:check` before pushing (CI lint runs prettier; local lint does not)
- Schema changes require a migration in the same commit (`pnpm db:check-drift` to validate)
- No `console.log`, no `any`, ESM only with `.js` extensions in relative imports (except Next.js)
