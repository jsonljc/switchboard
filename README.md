# Switchboard

Guardrail and approval orchestration for AI agents. Switchboard sits between your AI agent and the actions it wants to take, enforcing policies, scoring risk, routing approvals, and maintaining a tamper-evident audit trail.

## How It Works

When an AI agent proposes an action (e.g. "pause ad campaign X"), Switchboard:

1. **Resolves identity** — loads the principal's risk tolerance, spend limits, and forbidden behaviors
2. **Scores risk** — the cartridge provides domain-specific risk factors (dollars at risk, blast radius, reversibility); the engine computes a weighted score and risk category
3. **Evaluates policies** — runs the action through configurable policy rules (AND/OR/NOT conditions) to produce a decision: allow, deny, modify, or require approval
4. **Routes approval** — if needed, creates a cryptographically-bound approval request with a binding hash that prevents approving stale parameters
5. **Executes** — delegates to the cartridge for actual execution, records the result and an undo recipe if available
6. **Audits** — every state transition is recorded as a hash-chained audit entry for tamper detection

```
Agent Request
    │
    ▼
┌─────────────────┐
│  Entity Resolve  │──── ambiguous? → clarify
└────────┬────────┘
         ▼
┌─────────────────┐
│    Propose       │
│  ├ Identity      │
│  ├ Risk Score    │
│  ├ Policy Eval   │
│  └ Decision      │
└────────┬────────┘
         │
    ┌────┼────────────┐
    ▼    ▼            ▼
  DENY  AUTO-ALLOW   NEEDS APPROVAL
    │    │            │
    │    │     ┌──────┴──────┐
    │    │     │  Approval   │
    │    │     │  (approve/  │
    │    │     │   reject/   │
    │    │     │   patch)    │
    │    │     └──────┬──────┘
    │    ▼            ▼
    │  ┌─────────────────┐
    │  │    Execute       │
    │  │  (cartridge)     │
    │  └────────┬────────┘
    │           ▼
    │  ┌─────────────────┐
    │  │  Undo (optional) │
    │  └─────────────────┘
    ▼
  Audit Trail (hash-chained)
```

## Project Structure

```
switchboard/
├── packages/
│   ├── schemas          # Zod domain types (Envelope, Policy, RiskScore, etc.)
│   ├── core             # Policy engine, risk scorer, orchestrator, audit ledger
│   ├── cartridge-sdk    # SDK for building cartridges (ActionBuilder, TestCartridge)
│   └── db               # Prisma schema and client
├── cartridges/
│   └── ads-spend        # Meta/Google Ads cartridge (pause, resume, budget, targeting)
├── apps/
│   ├── api              # Fastify REST API with Swagger UI
│   └── chat             # Chat interface (Telegram bot)
├── Dockerfile           # Multi-stage build (api + chat targets)
└── docker-compose.yml   # Full stack: api, chat, postgres, redis
```

### Package Dependencies

```
schemas
   │
   ├──► cartridge-sdk
   │        │
   │        ├──► core
   │        │      │
   │        │      ├──► api
   │        │      └──► chat
   │        │
   │        └──► ads-spend
   │
   └──► db
```

## Quick Start

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) 9.x

### Setup

```bash
# Clone and install
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm install

# Build all packages
pnpm build

# Run tests (364 tests)
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### Development

```bash
# Start API server (port 3000) and chat server (port 3001) in watch mode
pnpm dev

# Or start individually
pnpm --filter @switchboard/api dev    # http://localhost:3000
pnpm --filter @switchboard/chat dev   # http://localhost:3001
```

The API server serves interactive Swagger documentation at [http://localhost:3000/docs](http://localhost:3000/docs).

### Docker

```bash
# Copy and configure environment
cp .env.example .env

# Start the full stack (api, chat, postgres, redis)
docker compose up

# Or build individual targets
docker build --target api -t switchboard-api .
docker build --target chat -t switchboard-chat .
```

## Environment Variables

See [`.env.example`](.env.example) for all available options:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API server port |
| `CHAT_PORT` | `3001` | Chat server port |
| `CORS_ORIGIN` | _(empty = allow all)_ | Comma-separated allowed origins |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot API token |
| `META_ADS_ACCESS_TOKEN` | — | Meta Ads API access token |
| `META_ADS_ACCOUNT_ID` | — | Meta Ads account ID |

## API Endpoints

All endpoints are documented via OpenAPI at `/docs`. Summary:

### Actions (`/api/actions`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/actions/propose` | Create a new action proposal |
| `POST` | `/api/actions/batch` | Batch-propose multiple actions |
| `GET` | `/api/actions/:id` | Get envelope by ID |
| `POST` | `/api/actions/:id/execute` | Execute an approved envelope |
| `POST` | `/api/actions/:id/undo` | Request undo of an executed action |

### Approvals (`/api/approvals`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/approvals/:id/respond` | Approve, reject, or patch a pending approval |
| `GET` | `/api/approvals/pending` | List pending approval requests |
| `GET` | `/api/approvals/:id` | Get approval details |

### Simulate (`/api/simulate`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/simulate` | Dry-run evaluation without side effects |

### Policies (`/api/policies`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/policies` | List policies (optionally filter by cartridgeId) |
| `POST` | `/api/policies` | Create a policy |
| `GET` | `/api/policies/:id` | Get policy by ID |
| `PUT` | `/api/policies/:id` | Update a policy |
| `DELETE` | `/api/policies/:id` | Delete a policy |

### Identity (`/api/identity`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/identity/specs` | Create an identity spec |
| `GET` | `/api/identity/specs/:id` | Get identity spec |
| `GET` | `/api/identity/specs/by-principal/:principalId` | Look up spec by principal |
| `PUT` | `/api/identity/specs/:id` | Update identity spec |
| `POST` | `/api/identity/overlays` | Create a role overlay |
| `GET` | `/api/identity/overlays?specId=X` | List overlays for a spec |
| `PUT` | `/api/identity/overlays/:id` | Update a role overlay |

### Audit (`/api/audit`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/audit` | Query audit entries with filters |
| `GET` | `/api/audit/verify` | Verify hash chain integrity |
| `GET` | `/api/audit/:id` | Get a single audit entry |

## Building a Cartridge

Cartridges are domain-specific plugins that teach Switchboard how to evaluate risk and execute actions for a particular service. See the [ads-spend cartridge](cartridges/ads-spend/) for a complete example.

```typescript
import type { Cartridge, CartridgeContext, ExecuteResult } from "@switchboard/cartridge-sdk";
import type { CartridgeManifest, RiskInput, GuardrailConfig } from "@switchboard/schemas";

export class MyCartridge implements Cartridge {
  getManifest(): CartridgeManifest {
    return {
      id: "my-service",
      name: "My Service Cartridge",
      version: "1.0.0",
      description: "Manages actions for My Service",
      actions: [
        { actionType: "my-service.do-thing", description: "Does a thing", requiredParams: ["thingId"] },
      ],
      requiredConnections: [],
      defaultPolicies: [],
    };
  }

  async getRiskInput(actionType: string, parameters: Record<string, unknown>): Promise<RiskInput> {
    return {
      baseRisk: "medium",
      exposure: { dollarsAtRisk: 0, blastRadius: "single_entity" },
      reversibility: "full",
      sensitivity: { entityVolatile: false, learningPhase: false, recentlyModified: false },
    };
  }

  async execute(
    actionType: string,
    parameters: Record<string, unknown>,
    context: CartridgeContext,
  ): Promise<ExecuteResult> {
    // Call your external service here
    return { success: true, summary: "Done", externalRefs: [], rollbackAvailable: false };
  }

  // Optional: entity resolution, context enrichment, guardrails, health check
}
```

For testing, use `TestCartridge` from the SDK:

```typescript
import { TestCartridge, createTestManifest } from "@switchboard/cartridge-sdk";

const cartridge = new TestCartridge(createTestManifest({ id: "test" }));
cartridge.onExecute(async () => ({ success: true, summary: "ok" }));
cartridge.onRiskInput(async () => ({ baseRisk: "low", /* ... */ }));
```

## Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @switchboard/core test
pnpm --filter @switchboard/api test

# Run with coverage
pnpm exec vitest run --coverage
```

## Database

The Prisma schema is at [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma). Currently the runtime uses in-memory storage; the Prisma schema defines the production data model.

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Seed database
pnpm db:seed
```

## CI

GitHub Actions runs on every push to `main` and on pull requests:

1. Install dependencies (`pnpm install --frozen-lockfile`)
2. Type check (`pnpm typecheck`)
3. Lint (`pnpm lint`)
4. Test (`pnpm test`)

## License

MIT
