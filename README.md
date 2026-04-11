# Switchboard

AI Agent Marketplace with trust-based pricing. An open platform where anyone can list AI agents — open-source, third-party, or native. Agents start free with no reputation. As users approve or reject their work, trust scores rise or fall, driving autonomy levels and pricing tiers automatically. Governance is the moat: every agent runs through Switchboard's policy engine, risk scoring, and approval pipeline.

## How It Works

```
Agent listed on marketplace (trust score: 50, tier: free)
    │
    ▼
Founder deploys agent (configure → connect → governance)
    │
    ▼
Agent receives task → produces output
    │
    ▼
┌─────────────────────────────────┐
│  Governance Pipeline            │
│  ├ Identity resolution          │
│  ├ Risk scoring                 │
│  ├ Policy evaluation            │
│  └ Approval routing             │
└────────────┬────────────────────┘
             │
       ┌─────┴─────┐
       ▼           ▼
    AUTO-ALLOW   NEEDS REVIEW
       │           │
       │     ┌─────┴─────┐
       │     ▼           ▼
       │   APPROVE    REJECT
       │     │           │
       │     │     Trust score ↓
       │     │     (−10 pts, streak reset)
       │     │
       │   Trust score ↑
       │   (+3 pts + streak bonus)
       ▼
    Output delivered
       │
       ▼
Trust score → Autonomy level → Price tier
  <40: supervised     free
  40-69: guided       basic/pro
  ≥70: autonomous     elite
```

### Trust Score Mechanics

- **Starting score**: 50 (every new agent)
- **Approval**: +3 points + streak bonus (up to +5 for consecutive approvals)
- **Rejection**: −10 points, streak resets to 0
- **Autonomy levels**: supervised (<40) → guided (40-69) → autonomous (≥70)
- **Price tiers**: free (<30) → basic (30-54) → pro (55-79) → elite (≥80)

Agents with high trust earn more autonomy (less human oversight) and can charge more. Agents that get rejected lose trust and require more supervision.

## Project Structure

```
switchboard/
├── packages/
│   ├── schemas          # Zod types — marketplace, governance, sessions, workflows
│   ├── core             # Policy engine, risk scorer, orchestrator, TrustScoreEngine, audit
│   ├── cartridge-sdk    # SDK for building action cartridges
│   ├── db               # Prisma schema, marketplace stores, credential encryption
│   └── agents           # Agent runtime — EventLoop, LLM infra, escalation, concurrency
├── apps/
│   ├── api              # Fastify REST API (marketplace + governance endpoints)
│   ├── chat             # Multi-channel chat (Telegram, WhatsApp, Slack)
│   ├── dashboard        # Next.js marketplace UI + task review queue
│   └── mcp-server       # MCP server for LLM tool use
├── Dockerfile           # Multi-stage build (api, chat, dashboard, mcp-server)
└── docker-compose.yml   # Full stack: api, chat, postgres, redis
```

### Key Marketplace Models

| Model              | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `AgentListing`     | Global catalog — name, type, trust score, autonomy level, price tier   |
| `AgentDeployment`  | Org's instance of a listing — config, governance settings, connections |
| `AgentTask`        | Unit of work — input, output, approve/reject status                    |
| `TrustScoreRecord` | Per-listing per-category — score, approvals, rejections, streak        |

### Package Dependencies

```
schemas
   │
   ├──► cartridge-sdk
   │        │
   │        └──► core (+ TrustScoreEngine, marketplace)
   │              │
   │              ├──► api (marketplace routes, governance)
   │              ├──► chat
   │              └──► mcp-server
   │
   └──► db (marketplace stores) ──► api, dashboard
```

## Quick Start

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9.x

### Setup

```bash
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

### Development

```bash
# Start all services in watch mode
pnpm dev

# Or individually
pnpm --filter @switchboard/api dev        # http://localhost:3000
pnpm --filter @switchboard/dashboard dev  # http://localhost:3002
pnpm --filter @switchboard/chat dev       # http://localhost:3001
```

### Docker

```bash
cp .env.example .env
docker compose up

# Or build individual targets
docker build --target api -t switchboard-api .
docker build --target dashboard -t switchboard-dashboard .
```

## API Endpoints

### Marketplace (`/api/marketplace`)

| Method     | Path                                   | Description                                    |
| ---------- | -------------------------------------- | ---------------------------------------------- |
| `GET`      | `/api/marketplace/listings`            | Browse agent listings (filter by status, type) |
| `GET`      | `/api/marketplace/listings/:id`        | Agent detail                                   |
| `POST`     | `/api/marketplace/listings`            | Create a listing                               |
| `GET`      | `/api/marketplace/listings/:id/trust`  | Trust score breakdown per category             |
| `POST`     | `/api/marketplace/listings/:id/deploy` | Deploy agent to org                            |
| `GET`      | `/api/marketplace/deployments`         | List org's active deployments                  |
| `GET/POST` | `/api/marketplace/tasks`               | List/create tasks                              |
| `POST`     | `/api/marketplace/tasks/:id/submit`    | Submit agent output                            |
| `POST`     | `/api/marketplace/tasks/:id/review`    | Approve/reject → updates trust score           |

### Governance (`/api/actions`, `/api/approvals`, `/api/policies`, `/api/identity`, `/api/audit`)

Full governance API for action proposals, approval workflows, policy management, identity resolution, and tamper-evident audit trail. See Swagger UI at `/docs`.

## Environment Variables

See [`.env.example`](.env.example) for all available options:

| Variable                     | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`               | PostgreSQL connection string                         |
| `REDIS_URL`                  | Redis connection string                              |
| `ANTHROPIC_API_KEY`          | Claude API key for LLM operations                    |
| `CREDENTIALS_ENCRYPTION_KEY` | Encryption key for stored credentials (min 32 chars) |
| `STRIPE_SECRET_KEY`          | Stripe API key for payment processing                |
| `NEXTAUTH_SECRET`            | NextAuth.js session encryption                       |
| `NEXTAUTH_URL`               | Dashboard canonical URL                              |

## Testing

```bash
pnpm test                                    # All tests
pnpm --filter @switchboard/core test         # Core + TrustScoreEngine
pnpm --filter @switchboard/schemas test      # Schema validation
pnpm --filter @switchboard/db test           # Store tests
pnpm test -- --coverage                      # With coverage
```

## License

MIT
