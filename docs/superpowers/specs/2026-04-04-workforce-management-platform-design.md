# Switchboard: AI Workforce Management Platform

**Date**: 2026-04-04
**Status**: Draft
**Author**: Jason Li

---

## The Problem

Solo founders increasingly use AI tools (ChatGPT, Claude, custom bots) alongside human freelancers (Upwork, Fiverr). But they manage each one separately — different tools, no unified view, no way to know who's actually delivering results.

The result: founders either micromanage everything (defeating the purpose) or blindly trust tools that may be producing mediocre work.

## The Insight

Existing tools like Linear, Asana, and Notion track _tasks_. They don't manage _workers_. The missing piece isn't another task board — it's a way to track **which workers (AI or human) you can actually trust**, and automatically adjust how much oversight they need.

A ChatGPT bot that consistently writes good Instagram captions should earn more freedom. A freelancer who misses deadlines should get more oversight. That's how a good manager thinks — but no tool does this today.

## The Product

**Switchboard** is a workforce management platform where solo founders manage their AI agents and human contractors from one dashboard, with built-in **trust scoring**, **approval workflows**, and **performance tracking**.

### What it is NOT

- **Not a marketplace** — you bring your own AI tools and freelancers
- **Not a done-for-you service** — you're still the boss; we make you a better one
- **Not another project management tool** — we manage _workers_, not just tasks

### One-Line Pitch

> "See which of your AI agents and freelancers actually deliver — and automatically give the reliable ones more freedom."

---

## How It Works

### Workers

A "worker" is anyone (or anything) that does work for you. Two types:

- **AI Agent** — ChatGPT, Claude, a custom bot, any AI tool
- **Human** — a freelancer, contractor, or part-time team member

You add workers to your Switchboard dashboard. Each one gets tracked.

### Trust Scores (0–100)

Every worker gets a **trust score** per type of work they do. Think of it like a credit score, but for job performance.

- New workers start at **50** (neutral — "let's see how you do")
- Every time you **approve** their work: score goes up
- Every time you **reject** their work: score goes down
- Doing good work consistently earns **streak bonuses** (faster score growth)
- Workers who haven't done anything recently **decay** slightly (use it or lose it)

### Autonomy Levels

Trust scores automatically determine how much freedom a worker gets:

| Level          | Score  | What Happens                                                                                                                |
| -------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Supervised** | 0–39   | Every piece of work must be approved by you before it goes anywhere                                                         |
| **Guided**     | 40–69  | You get notified when work is done. You have 4 hours to review. If you don't, it auto-approves (with a smaller trust boost) |
| **Autonomous** | 70–100 | Worker's output goes live automatically. You see it in your activity feed but don't need to act                             |

**The key insight**: workers _earn_ autonomy through consistent good work. Bad work loses it. This happens automatically.

### Tasks

A task is a piece of work you assign to a worker:

- Title and description ("Write 3 Instagram captions for product launch")
- Task type (content, code, design, research, outreach)
- Deadline (optional)
- Acceptance criteria ("Must include product name and CTA")
- Assigned worker

### Policies (Rules You Set)

You can set rules that apply across all workers:

- **Spend limits**: "Max $50/day across all workers"
- **Required approval**: "Never publish anything without my sign-off"
- **Auto-pause**: "If a worker's trust drops below 30, pause them automatically"
- **Rate limits**: "No worker can do more than 10 tasks per day"

These ship with sensible defaults. You only configure them if you want to.

---

## User Experience

### Getting Started (5 minutes)

```
1. Sign up
2. Name your workspace ("Jason's Studio")
3. Add your first worker:

   "My ChatGPT content writer"
   Type: AI Agent
   Good at: content, social-media

   — or —

   "Sarah (designer on Fiverr)"
   Type: Human
   Good at: design, branding
   Notify via: sarah@email.com
```

### Day-to-Day

```
1. You create a task: "Write 3 Instagram captions for product launch"
   → Assign to your ChatGPT writer
   → Trust score: 52 (guided) → you get a notification

2. You paste the AI's output into Switchboard (or it arrives via automation)
   → It appears in your approval queue
   → You tap "Approve" ✓
   → Trust score: 52 → 55

3. After 10 approved tasks:
   → Trust score: 72 (autonomous!)
   → Outputs go straight to your activity feed
   → No approval needed anymore

4. One day the AI produces bad copy. You reject it.
   → Trust score: 72 → 65 (back to guided)
   → You'll be notified on future outputs again
```

### Scaling Up

Your dashboard shows your whole team at a glance:

```
WORKFORCE                          TRUST   TASKS   APPROVAL RATE
─────────────────────────────────────────────────────────────────
ChatGPT Writer      AI Agent        78 ★    42      90%
Claude Researcher   AI Agent        61      15      80%
Custom GPT Coder    AI Agent        45      8       62%
Sarah (designer)    Human           85 ★    20      95%
Mike (video editor) Human           38      5       60%
```

★ = autonomous (their work goes live without your approval)

---

## How AI Agents Connect

Three levels — start simple, add automation later:

**Level 1 — Copy & Paste (launch)**
You copy the task into ChatGPT/Claude/whatever, then paste the output into Switchboard. Simple form: paste text, upload a file, or drop a URL. Zero setup required.

**Level 2 — Automated Webhook (later)**
Switchboard generates a unique secret URL for each AI worker. You wire it up via Zapier/Make/custom code so the AI's output automatically arrives in Switchboard. No more copy-pasting.

**Level 3 — Direct API (future)**
Switchboard triggers the AI agent automatically. Full autopilot. Not in initial launch.

---

## Go-to-Market: Starting Narrow

### Phase 1: Content Creators (launch)

**Who**: Solo founders using AI for content — social media, blog posts, newsletters, ad copy.

**Why start here**:

- This is where AI adoption is highest right now
- Content is easy to judge (approve or reject a caption — no ambiguity)
- Low risk (bad content is fixable, not catastrophic)
- High volume (daily content = fast trust score updates = the system proves itself quickly)
- **Natural viral moment**: "My AI writer just hit trust score 90 — it publishes autonomously now" → screenshot → Twitter

### Phase 2: Dev Teams

Founders using coding agents (Cursor, Claude Code, Devin) alongside human developers.

### Phase 3: Full Operations

Any team function: research, design, data analysis, outreach, customer support.

---

## What Proves the Big Vision Works

Phase 1 isn't just about content. It tests four things:

1. **Do trust scores actually work?** Do founders find the scores accurate and useful?
2. **Do founders add humans too?** If they only add AI tools and never freelancers, the "mixed workforce" thesis is wrong.
3. **Do founders use policies?** If nobody configures rules, governance isn't a product — it's just infrastructure.
4. **Do founders expand?** If content founders naturally start adding other worker types, the platform has legs.

If any of these fail, we learn early and adjust.

---

## Pricing

| Tier     | Price  | What You Get                                                                     |
| -------- | ------ | -------------------------------------------------------------------------------- |
| **Free** | $0     | 2 workers, 50 tasks/month, basic trust scores                                    |
| **Pro**  | $29/mo | 10 workers, 500 tasks/month, autonomy levels, policies, Slack notifications      |
| **Team** | $79/mo | Unlimited workers & tasks, API access, custom policies, team seats, audit export |

**Key**: This is a tool you pay for monthly (like Notion or Linear). We never do the work for you, so there's no delivery cost or risk on our side. Pure software business.

**Built-in switching cost**: Your workers' trust score history lives in Switchboard. You don't want to lose 6 months of performance data by switching tools.

---

## Competition

| Product                     | What they do                       | Why we're different                                                        |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| **Linear / Asana / Notion** | Track tasks for humans             | We track _workers_ (AI + human). Trust scoring doesn't exist there.        |
| **Zapier / Make**           | Connect tools together             | We add performance tracking and governance on top                          |
| **Relevance AI / CrewAI**   | Orchestrate multiple AI agents     | AI-only. We include humans. Trust scoring is unique.                       |
| **Invisible Technologies**  | Deliver outcomes using AI + humans | They do the work (services). We help _you_ manage your workers (software). |
| **Upwork / Fiverr**         | Find freelancers                   | We don't find workers. We help you manage the ones you already have.       |

**Our unique space**: Nobody combines AI agent management + human worker management + trust-based autonomy in one platform.

---

## Risks

| What could go wrong                    | How likely | How we handle it                                                                   |
| -------------------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| Founders only add AI, never humans     | High       | Onboarding prompts for both. Track this metric closely.                            |
| Trust scores feel random/unfair        | Medium     | Show exactly why every score changed: "Score +3: you approved 'social-media' task" |
| Too complex for non-technical founders | Medium     | Ship with smart defaults. Advanced features behind Pro tier.                       |
| Webhook setup too hard                 | Medium     | Launch with copy-paste (Level 1). Webhooks are optional.                           |
| AI outputs too varied to judge         | Medium     | Provide templates. Let founders set acceptance criteria per task type.             |

---

## Success Criteria (Launch)

- [ ] Founder can add AI agent and human workers
- [ ] Founder can create and assign tasks
- [ ] Founder can submit worker output (paste/upload)
- [ ] Outputs route to approval based on trust score
- [ ] Trust scores update on approve/reject
- [ ] Autonomy levels change automatically
- [ ] Dashboard shows workforce with trust scores
- [ ] Founder can set basic policies

### Metrics to Watch

- Do founders add both AI agents AND human workers?
- Do founders configure policies beyond defaults?
- Do trust scores match founder satisfaction?
- Do founders grant more autonomy over time?
- Monthly retention > 40% at 3 months

---

---

# Technical Specification (for engineers)

_Everything below is implementation detail. Skip if you're not building it._

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Dashboard (Next.js)                            │
│  - Workforce view (agents + humans)             │
│  - Trust scores & performance                   │
│  - Approval queue                               │
│  - Activity feed & audit trail                  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  API (Fastify)                                  │
│  - Worker management (register, configure)      │
│  - Task assignment & tracking                   │
│  - Approval workflows                           │
│  - Webhook receivers (agent outputs)            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Governance Engine (existing)                   │
│  - Policy evaluation (10-step pipeline)         │
│  - Risk scoring                                 │
│  - CompetenceTracker (trust scores)             │
│  - Approval state machine                       │
│  - Audit ledger                                 │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  Worker Adapters                                │
│  - AI Agent adapters (API-based agents)         │
│  - Human worker adapters (email/Slack notify)   │
│  - Webhook ingestion (results from agents)      │
└─────────────────────────────────────────────────┘
```

## Existing Infrastructure Reuse

| Existing Module         | New Role                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| `CompetenceTracker`     | Trust score engine — records success/failure per worker per task type   |
| Policy Engine (10-step) | Evaluates task assignments and outputs against founder-defined policies |
| Approval State Machine  | Routes outputs needing review to founder, with expiry and delegation    |
| Audit Ledger            | Full trail of every task, decision, and score change                    |
| Risk Scorer             | Composite risk assessment for high-stakes tasks                         |
| Governance Profiles     | Preset autonomy configurations (observe/guarded/strict/locked)          |
| Identity System         | Worker identity resolution, role overlays                               |
| Decision Trace          | Explainable decisions — "why was this flagged for review?"              |

## New Components

**1. Worker Registry** — CRUD for workers, connection config, capabilities, per-worker trust dashboard

**2. Task Engine** — Task creation/assignment/tracking, deadline monitoring, output collection, acceptance/rejection workflow feeding trust scores

**3. Worker Adapters** — Webhook receiver (AI agents), notification sender (email/Slack for humans), future: direct API adapters

**4. Dashboard Views** — Workforce overview, worker detail, task board, approval queue, activity feed

## Changes to CompetenceTracker

The existing `CompetenceTracker` needs three modifications:

1. **Initial score → 50** (currently 0 in `getOrCreateRecord()`). New workers start at "guided."
2. **New thresholds**: `supervisedCeiling: 39`, `guidedCeiling: 69`, `autonomousFloor: 70` (replacing binary `promotionScore`/`demotionScore`)
3. **New method `getAutonomyLevel(principalId, actionType)`** → returns `"supervised" | "guided" | "autonomous"`

## Worker-to-Principal Mapping

When a Worker is created, a corresponding Principal record is created with `type: "worker"` and `subType: "ai-agent" | "human"`. **Requires schema change**: the existing Principal `type` enum must be extended to include `"worker"`. The Principal ID is stored on the Worker record as `principalId` and used as `principalId` in `CompetenceRecord`. This gives every worker:

- Trust scores via `CompetenceTracker`
- Policy evaluation via the governance engine
- Audit trail via the audit ledger
- Identity resolution via the identity system

## Integration Model (Technical Detail)

**Level 1: Manual** — Form submission on dashboard (paste text, upload file, enter URL).

**Level 2: Webhook** — Unique URL per worker. Payload:

```json
{
  "taskId": "task_abc123",
  "output": {
    "type": "text|file_url|structured",
    "content": "...",
    "metadata": {}
  },
  "workerSecret": "wk_sec_..."
}
```

Rate-limited (60 req/min per worker), 1MB max, authenticated via `workerSecret`.

**Level 3: API pull (future)** — Switchboard calls agent's API. Not Phase 1.

## Data Model

### New Prisma Models

```prisma
model Worker {
  id              String       @id @default(cuid())
  organizationId  String
  principalId     String       @unique
  name            String
  type            WorkerType   // AI_AGENT | HUMAN
  status          WorkerStatus // ACTIVE | PAUSED | ARCHIVED
  capabilities    String[]
  connectionConfig Json
  webhookSecret   String?
  metadata        Json?
  createdBy       String
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  tasks           Task[]       @relation("WorkerTasks")
  organization    OrganizationConfig @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
}

model Task {
  id                 String     @id @default(cuid())
  organizationId     String
  title              String
  description        String
  taskType           String
  status             TaskStatus // PENDING | ASSIGNED | IN_PROGRESS | REVIEW | COMPLETED | FAILED
  priority           String?
  deadline           DateTime?
  acceptanceCriteria String?
  outputFormat       String?
  assignedWorkerId   String?
  autonomyOverride   String?
  output             Json?
  reviewResult       String?    // APPROVED | REJECTED | REVISION_REQUESTED
  reviewNotes        String?
  completedAt        DateTime?
  createdBy          String
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt

  assignedWorker     Worker?    @relation("WorkerTasks", fields: [assignedWorkerId], references: [id])
  organization       OrganizationConfig @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
  @@index([assignedWorkerId])
  @@index([status])
}

enum WorkerType { AI_AGENT  HUMAN }
enum WorkerStatus { ACTIVE  PAUSED  ARCHIVED }
enum TaskStatus { PENDING  ASSIGNED  IN_PROGRESS  REVIEW  COMPLETED  FAILED }
```

### Migration from Existing Employee Models

Decision: **deprecate, don't migrate.**

- `EmployeeRegistration` → replaced by `Worker`
- `EmployeeSkill` → replaced by `Worker.capabilities[]`
- `EmployeePerformanceEvent` → replaced by `CompetenceRecord`
- `ContentDraft` → replaced by `Task.output` + `Task.reviewResult`
- `ContentCalendarEntry` → not needed in Phase 1

Old Employee models remain in schema during Phase 1 (no data loss). Removed in Phase 2 after confirming no references.

### Existing Models Leveraged

- `CompetenceRecord` — worker.principalId = CompetenceRecord.principalId
- `ActionEnvelope` — wraps task outputs through governance pipeline
- `ApprovalRecord` — manages review workflows
- `AuditEntry` — immutable decision log
- `OrganizationConfig` — reused for workspace; onboarding creates an OrganizationConfig

## API Routes

All routes require auth. Org-scoped via auth token.

### Worker Routes (`/api/workers`)

| Method   | Path                     | Description                                  |
| -------- | ------------------------ | -------------------------------------------- |
| `POST`   | `/api/workers`           | Register worker (creates Principal + Worker) |
| `GET`    | `/api/workers`           | List workers with trust scores               |
| `GET`    | `/api/workers/:id`       | Worker detail (score history, stats)         |
| `PATCH`  | `/api/workers/:id`       | Update worker                                |
| `DELETE` | `/api/workers/:id`       | Archive worker (soft delete)                 |
| `GET`    | `/api/workers/:id/trust` | Trust score breakdown by task type           |

### Task Routes (`/api/tasks`)

| Method  | Path                    | Description                                 |
| ------- | ----------------------- | ------------------------------------------- |
| `POST`  | `/api/tasks`            | Create task                                 |
| `GET`   | `/api/tasks`            | List tasks (filter by status, worker, type) |
| `GET`   | `/api/tasks/:id`        | Task detail                                 |
| `PATCH` | `/api/tasks/:id`        | Update task                                 |
| `POST`  | `/api/tasks/:id/submit` | Submit output                               |
| `POST`  | `/api/tasks/:id/review` | Approve/reject (updates trust score)        |

### Webhook Routes

| Method | Path                              | Description             |
| ------ | --------------------------------- | ----------------------- |
| `POST` | `/api/webhooks/worker/:webhookId` | Receive AI agent output |

### Existing Routes (reused)

- `/api/approvals` — approval queue
- `/api/audit` — audit trail
- `/api/policies` — policy management
- `/api/governance` — governance profiles

## Key Technical Decisions

1. **Workers are principals** — reuse existing identity/principal system
2. **Tasks flow through the policy engine** — task assignment = action proposal
3. **Manual-first, webhook-later** — launch with paste, add webhooks in fast follow
4. **Notification-first for humans** — email/Slack when assigned
5. **Dashboard is primary interface** — governance runs invisibly underneath

## What Stays, Changes, Is New

### Stays

- Governance engine, CompetenceTracker, audit ledger, identity system
- Credential encryption, LLM adapter, knowledge pipeline

### Changes

- Dashboard — rebuild views for workforce management
- API routes — add worker and task endpoints
- Onboarding — new workspace + worker setup flow
- `employee-sdk` — evaluate repurposing as worker template SDK

### New

- Worker registry (model, store, routes)
- Task engine (model, store, routes, assignment logic)
- Worker adapters (webhook, notification)
- Trust score API (expose CompetenceTracker via REST)
- Dashboard workforce views
