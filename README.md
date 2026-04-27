# Switchboard

Governed operating system for revenue actions. Every business action — ad optimization, creative production, calendar booking, CRM updates — flows through a single control plane with governance, lifecycle management, persistence, and human override as first-class concerns.

## Repo Truth

Switchboard is **not** a collection of smart agents. It is an operating spine with one control plane (`PlatformIngress`), one lifecycle owner (`PlatformLifecycle`), one persistence truth (`WorkTrace`), and strict governance (`GovernanceGate`). Skills are business-facing capabilities. Channels are ingress surfaces. Governance, idempotency, auditability, and recovery are architectural. See [`docs/DOCTRINE.md`](docs/DOCTRINE.md) for the full architectural doctrine.

## How It Works

```
Channel (Telegram / WhatsApp / Slack / API / MCP)
    │
    ▼
DeploymentResolver  →  resolve org + skill + trust context
    │
    ▼
PlatformIngress.submit()  →  normalize WorkUnit, enforce idempotency
    │
    ▼
┌─────────────────────────────────┐
│  GovernanceGate.evaluate()      │
│  ├ Identity resolution          │
│  ├ Policy evaluation            │
│  ├ Risk scoring                 │
│  └ Approval routing             │
└────────────┬────────────────────┘
             │
       ┌─────┴─────┐
       ▼           ▼
    EXECUTE    REQUIRE APPROVAL
       │           │
       │     Human reviews
       │     (approve / reject → trust score update)
       │
       ▼
ExecutionMode dispatches work
  ├ SkillMode    — LLM tool-calling with auditable tools
  ├ PipelineMode — async jobs via Inngest
  └ CartridgeMode — legacy deterministic (bridge only)
       │
       ▼
WorkTrace persisted  →  canonical lifecycle record
```

### What's Live

Alex is the first revenue wedge — a WhatsApp-native booking assistant that converts inbound leads to calendar meetings. The deployed path: WhatsApp → PlatformIngress/governance → Alex skill execution → Google Calendar booking → attribution/outcome recording. Everything flows through the governed control plane with idempotency, audit trail, and human override.

## Project Structure

```
packages/
├── schemas/            # Zod schemas & shared types (no internal deps)
├── sdk/                # Agent manifest, handler interface, test harness
├── cartridge-sdk/      # Legacy cartridge interface (bridge only)
├── creative-pipeline/  # Creative content pipeline (async jobs via Inngest)
├── ad-optimizer/       # Ad platform integration + optimization
├── core/               # Platform ingress, governance, skill runtime, orchestration
└── db/                 # Prisma ORM, store implementations, credential encryption

apps/
├── api/          # Fastify REST API — platform ingress + governance (port 3000)
├── chat/         # Multi-channel chat — Telegram, WhatsApp, Slack (port 3001)
├── dashboard/    # Next.js operator UI + deployment controls (port 3002)
└── mcp-server/   # MCP server for LLM tool use
```

### Dependency Layers

```
Layer 1: schemas                                    → no internal deps
Layer 2: sdk, cartridge-sdk, creative-pipeline, ad-optimizer → schemas only
Layer 3: core                                       → schemas + sdk + cartridge-sdk
Layer 4: db                                         → schemas + core
Layer 5: apps/*                                     → may import anything
```

## Quick Start

### Prerequisites

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

### Setup

```bash
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm install
./scripts/setup-env.sh                        # generates secrets into .env AND apps/dashboard/.env.local
pnpm db:migrate                                # apply Prisma migrations
pnpm db:seed                                   # seed admin@switchboard.local / admin123
pnpm build
```

### Development

```bash
pnpm dev                                      # all services in watch mode

pnpm --filter @switchboard/api dev            # http://localhost:3000
pnpm --filter @switchboard/dashboard dev      # http://localhost:3002
pnpm --filter @switchboard/chat dev           # http://localhost:3001 (requires a channel token, see below)
```

**Note:** `apps/chat` warns (and starts with no inbound channels) when none of `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`+`WHATSAPP_PHONE_NUMBER_ID`, or `SLACK_BOT_TOKEN` is set in development; in production, the same condition is a hard error. Configure at least one channel token to actually receive messages.

### Working with the database

Edits to `packages/db/prisma/schema.prisma` must be paired with a migration in the same commit. After editing the schema:

```bash
pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
git add packages/db/prisma/migrations/
```

`pnpm db:check-drift` runs the same validation locally (requires a running PostgreSQL — Prisma uses a shadow database to compare migrations against the schema). CI runs it on every PR and blocks merges when drift is detected.

### Docker

```bash
cp .env.example .env
docker compose up

# Individual targets
docker build --target api -t switchboard-api .
docker build --target chat -t switchboard-chat .
docker build --target mcp-server -t switchboard-mcp .
docker build --target dashboard -t switchboard-dashboard .
```

## API

### Governed Execution (`/api/execute`, `/api/actions`)

All business actions enter through `PlatformIngress`. Requires `Idempotency-Key` header.

### Governance (`/api/approvals`, `/api/policies`, `/api/identity`, `/api/audit`)

Approval workflows, policy management, identity resolution, tamper-evident audit trail.

### Skills & Deployment (`/api/marketplace`)

Skill registration and deployment surfaces. Execution and governance state. Provisioning and runtime management.

See Swagger UI at `/docs` for full endpoint documentation.

## Environment Variables

See [`.env.example`](.env.example) for all available options.

## Testing

```bash
pnpm test                                    # all tests
pnpm --filter @switchboard/core test         # core + governance
pnpm --filter @switchboard/api test          # API routes
pnpm test -- --coverage                      # with coverage
```

## License

MIT
