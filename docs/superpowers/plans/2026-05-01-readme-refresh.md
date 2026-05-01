# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the root `README.md` into an operator-led github.com front door (with a contributor section preserved), and add a small SVG architecture diagram. No code, schema, or test changes.

**Architecture:** Single-file rewrite of `README.md` plus one new asset `docs/assets/architecture.svg`. README is structured: Hero → Three Wedges → Why Switchboard Outperforms Humans → How It Works (SVG + ASCII) → For Contributors → Docs Index → License. Every claim traces back to the audit ledger in the spec.

**Tech Stack:** Plain markdown, hand-rolled SVG. No build step. Renders on github.com.

**Spec:** `docs/superpowers/specs/2026-05-01-readme-refresh-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `README.md` | Modify (full rewrite) | github.com front door for both operators and contributors. |
| `docs/assets/architecture.svg` | Create | Simple 5-box control-plane diagram. Embedded in README's "How It Works" section. |
| `docs/assets/` | Create dir | Container for diagram (and future assets). No `.gitkeep` needed once `architecture.svg` is committed. |

The README is intentionally one file: github.com renders it as the repo landing page. Splitting to `docs/CONTRIBUTING.md` is deferred unless the README ends up over ~350 lines after drafting.

---

## Branch context

Plan executes on branch **`docs/readme-refresh`** in worktree **`/Users/jasonli/switchboard/.worktrees/readme-refresh`**. Verify before each commit:

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git branch --show-current  # must print: docs/readme-refresh
git status --short
```

---

## Task 1: Create the SVG architecture diagram

**Files:**
- Create: `docs/assets/architecture.svg`

- [ ] **Step 1: Create the assets directory**

```bash
mkdir -p /Users/jasonli/switchboard/.worktrees/readme-refresh/docs/assets
```

- [ ] **Step 2: Write the SVG**

Write `docs/assets/architecture.svg` with this exact content:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 280" role="img" aria-label="Switchboard control plane architecture">
  <title>Switchboard control plane</title>
  <desc>Channel feeds PlatformIngress, which calls GovernanceGate, which routes to ExecutionMode, whose results land in WorkTrace.</desc>
  <style>
    .box { fill: #fefcf7; stroke: #8a6a3a; stroke-width: 1.5; }
    .label { font-family: 'Inter', system-ui, sans-serif; font-size: 14px; fill: #2a2218; font-weight: 500; }
    .sub { font-family: 'Inter', system-ui, sans-serif; font-size: 11px; fill: #6a5a44; }
    .arrow { fill: none; stroke: #8a6a3a; stroke-width: 1.5; marker-end: url(#arrowhead); }
  </style>
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#8a6a3a"/>
    </marker>
  </defs>

  <!-- Channel -->
  <rect class="box" x="20" y="100" width="140" height="80" rx="6"/>
  <text class="label" x="90" y="135" text-anchor="middle">Channel</text>
  <text class="sub" x="90" y="155" text-anchor="middle">WhatsApp · Slack</text>
  <text class="sub" x="90" y="170" text-anchor="middle">Telegram · API · MCP</text>

  <!-- PlatformIngress -->
  <rect class="box" x="190" y="100" width="160" height="80" rx="6"/>
  <text class="label" x="270" y="135" text-anchor="middle">PlatformIngress</text>
  <text class="sub" x="270" y="155" text-anchor="middle">Normalize WorkUnit</text>
  <text class="sub" x="270" y="170" text-anchor="middle">Idempotency dedup</text>

  <!-- GovernanceGate -->
  <rect class="box" x="380" y="100" width="160" height="80" rx="6"/>
  <text class="label" x="460" y="135" text-anchor="middle">GovernanceGate</text>
  <text class="sub" x="460" y="155" text-anchor="middle">Identity · Policy · Risk</text>
  <text class="sub" x="460" y="170" text-anchor="middle">Approval routing</text>

  <!-- ExecutionMode -->
  <rect class="box" x="570" y="100" width="160" height="80" rx="6"/>
  <text class="label" x="650" y="135" text-anchor="middle">ExecutionMode</text>
  <text class="sub" x="650" y="155" text-anchor="middle">Skill · Pipeline</text>
  <text class="sub" x="650" y="170" text-anchor="middle">Cartridge · Workflow</text>

  <!-- WorkTrace -->
  <rect class="box" x="760" y="100" width="100" height="80" rx="6"/>
  <text class="label" x="810" y="135" text-anchor="middle">WorkTrace</text>
  <text class="sub" x="810" y="155" text-anchor="middle">Hash-chained</text>
  <text class="sub" x="810" y="170" text-anchor="middle">audit record</text>

  <!-- Arrows -->
  <line class="arrow" x1="160" y1="140" x2="186" y2="140"/>
  <line class="arrow" x1="350" y1="140" x2="376" y2="140"/>
  <line class="arrow" x1="540" y1="140" x2="566" y2="140"/>
  <line class="arrow" x1="730" y1="140" x2="756" y2="140"/>

  <!-- Human approval branch -->
  <rect class="box" x="380" y="220" width="160" height="40" rx="6"/>
  <text class="label" x="460" y="245" text-anchor="middle">Human approval</text>
  <line class="arrow" x1="460" y1="180" x2="460" y2="216"/>
</svg>
```

- [ ] **Step 3: Verify the SVG opens**

Run: `open /Users/jasonli/switchboard/.worktrees/readme-refresh/docs/assets/architecture.svg`
Expected: Diagram opens in default viewer. Five labeled boxes in a row connected by arrows, with a "Human approval" box hanging off GovernanceGate. No rendering errors.

(If running headless, instead: `python3 -c "import xml.etree.ElementTree as ET; ET.parse('/Users/jasonli/switchboard/.worktrees/readme-refresh/docs/assets/architecture.svg'); print('valid XML')"` — expected: `valid XML`.)

- [ ] **Step 4: Stage and commit**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git branch --show-current  # confirm: docs/readme-refresh
git add docs/assets/architecture.svg
git commit -m "docs(readme): add control-plane architecture SVG"
```

---

## Task 2: Replace `README.md` with the new front-door content

This task replaces the entire `README.md` in one edit. The current file is 179 lines; the new file is ~290 lines and is content-complete (no placeholders). Doing it as one write avoids a half-rewritten README on disk between commits.

**Files:**
- Modify: `README.md` (full rewrite — overwrite entire file)

- [ ] **Step 1: Confirm current README is committed and clean before overwriting**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git status --short README.md
```

Expected: empty output (no pending changes to README.md). If non-empty, stop and reconcile.

- [ ] **Step 2: Overwrite `README.md` with the new content**

Write the entire file. Final content:

````markdown
# Switchboard

> **Governed operating system for revenue actions.**

Switchboard runs the operations side of a business through one control plane. Every revenue action — answering an inbound lead, optimizing ad spend, producing a creative — flows through the same governance, audit trail, idempotency, and human-override paths. One platform, three revenue wedges, one source of truth.

---

## Three Revenue Wedges

| Wedge | Status | What it does |
|---|---|---|
| **Lead-to-Booking (Alex)** | `Alpha` | WhatsApp-native conversion agent. Inbound lead → governed qualification → Google Calendar booking. Actively under hardening; not yet shipped. |
| **Ad Optimization** | `Production-grade` | Meta + Google integrations. Lead ingestion, funnel and saturation analysis, automated budget and creative recommendations — all routed through governance. |
| **Product / Character / Director (PCD)** | `Planned` | Character-consistent creative across Sora, Veo, Runway, Kling, and HeyGen. Currently developed in a separate repo ([`creativeagent`](https://github.com/jsonljc/creativeagent)); integration into Switchboard targeted for a later release. |

Status labels describe code maturity, not deployment status. We do not claim a wedge is "live" unless it is.

---

## Why Switchboard Outperforms Human Operators

These are properties of the architecture, not marketing. Each one ties back to a real component in the codebase.

- **24/7 sub-second response.** Channel adapters answer inbound traffic in seconds. A human inbox answers in hours, and decay curves on conversion are steep.
- **Nothing slips through the cracks.** Every action becomes a `WorkUnit` and is persisted in `WorkTrace` (`packages/core/src/platform/work-trace.ts`). No forgotten follow-ups, no "I missed that DM."
- **Consistent judgment at scale.** `GovernanceGate.evaluate()` (`packages/core/src/platform/governance/governance-gate.ts`) applies the same identity, policy, and risk evaluation to action #1 and action #10,000. Humans drift, get tired, and apply rules unevenly.
- **Parallel wedges, one operator.** One platform runs lead-to-booking, ad optimization, and (soon) creative production at the same time. A human team needs three specialists plus a coordinator.
- **A learning loop that compounds.** Every decision is hashed, anchored to an audit entry, and outcome-linked (`work-trace-integrity.ts`). Policy changes are evaluated against history. Tribal knowledge does not walk out the door.
- **Compliance built in.** Tamper-evident audit trail (SHA-256 content hash + audit-anchor binding) and first-class human-override paths (`packages/core/src/approval/lifecycle-service.ts`) mean speed *without* losing accountability. Most "AI agents" trade one for the other.
- **Fixed-cost economics.** Marginal cost per action approaches zero; headcount cost scales linearly with volume. A switchboard that handles 10× the volume next quarter does not need 10× the budget.

---

## How It Works

![Switchboard control plane: Channel → PlatformIngress → GovernanceGate → ExecutionMode → WorkTrace, with Human Approval branching off GovernanceGate](docs/assets/architecture.svg)

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

### What's Live Today

- **Ad Optimization:** Meta CAPI + Google Offline Conversions integration is real and shipping data. Funnel analysis, saturation detection, and Inngest-driven daily/weekly audits are wired and running.
- **Alex (Lead-to-Booking):** WhatsApp ingress, governance gating, and the calendar-booking tool are all wired end-to-end. The skill is in alpha — three known launch blockers are tracked in `.audit/` and being worked off before we promote it to production.
- **PCD (Creative Studio):** Lives in [`creativeagent`](https://github.com/jsonljc/creativeagent) today. Switchboard's `packages/creative-pipeline` carries UGC scaffolding (Kling provider, scripting, scene casting, realism QA) for the future integration.

For deeper architecture: [`docs/DOCTRINE.md`](docs/DOCTRINE.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## For Contributors

Switchboard is a TypeScript monorepo (pnpm workspaces, Turborepo). The codebase is organized by dependency layer; circular dependencies are forbidden.

### Project Structure

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
Layer 1: schemas                                              → no internal deps
Layer 2: sdk, cartridge-sdk, creative-pipeline, ad-optimizer  → schemas only
Layer 3: core                                                 → schemas + sdk + cartridge-sdk
Layer 4: db                                                   → schemas + core
Layer 5: apps/*                                               → may import anything
```

### Quick Start

#### Prerequisites

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

#### Setup

```bash
git clone https://github.com/jsonljc/switchboard.git
cd switchboard
pnpm install
./scripts/setup-env.sh                        # generates secrets into .env AND apps/dashboard/.env.local
pnpm db:migrate                                # apply Prisma migrations
pnpm db:seed                                   # seed admin@switchboard.local / admin123
pnpm build
```

#### Development

```bash
pnpm dev                                      # all services in watch mode

pnpm --filter @switchboard/api dev            # http://localhost:3000
pnpm --filter @switchboard/dashboard dev      # http://localhost:3002
pnpm --filter @switchboard/chat dev           # http://localhost:3001 (requires a channel token, see below)
```

`apps/chat` warns (and starts with no inbound channels) when none of `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`, or `SLACK_BOT_TOKEN` is set in development; in production, the same condition is a hard error. Configure at least one channel token to actually receive messages.

#### Working with the database

Edits to `packages/db/prisma/schema.prisma` must be paired with a migration in the same commit.

```bash
pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
git add packages/db/prisma/migrations/
```

`pnpm db:check-drift` runs the same validation locally (requires a running PostgreSQL — Prisma uses a shadow database to compare migrations against the schema). CI runs it on every PR and blocks merges when drift is detected.

#### Docker

```bash
cp .env.example .env
docker compose up

# Individual targets
docker build --target api -t switchboard-api .
docker build --target chat -t switchboard-chat .
docker build --target mcp-server -t switchboard-mcp .
docker build --target dashboard -t switchboard-dashboard .
```

### Testing

```bash
pnpm test                                    # all tests
pnpm --filter @switchboard/core test         # core + governance
pnpm --filter @switchboard/api test          # API routes
pnpm test -- --coverage                      # with coverage
```

---

## Docs & Further Reading

- [`docs/DOCTRINE.md`](docs/DOCTRINE.md) — architectural rules and invariants
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — deep architectural reference
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — runbook for operators
- [`docs/DEPLOYMENT-CHECKLIST.md`](docs/DEPLOYMENT-CHECKLIST.md) — production deploy checklist
- [`creativeagent`](https://github.com/jsonljc/creativeagent) — separate repo for the PCD wedge (will be integrated)

---

## API

### Governed Execution (`/api/execute`, `/api/actions`)

All business actions enter through `PlatformIngress`. Requires the `Idempotency-Key` header.

### Governance (`/api/approvals`, `/api/policies`, `/api/identity`, `/api/audit`)

Approval workflows, policy management, identity resolution, and the tamper-evident audit trail.

### Skills & Deployment (`/api/marketplace`)

Skill registration and deployment surfaces. Execution and governance state. Provisioning and runtime management.

See Swagger UI at `/docs` for full endpoint documentation.

---

## Environment Variables

See [`.env.example`](.env.example) for all available options. Never commit `.env` files or secrets.

---

## License

MIT
````

(End of file content.)

- [ ] **Step 3: Verify file written and line count is reasonable**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
wc -l README.md
```

Expected: between 240 and 320 lines. If outside that range, re-check the write.

- [ ] **Step 4: Confirm all documented links resolve to existing files**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
for f in docs/DOCTRINE.md docs/ARCHITECTURE.md docs/OPERATIONS.md docs/DEPLOYMENT-CHECKLIST.md docs/assets/architecture.svg .env.example; do
  test -f "$f" && echo "OK  $f" || echo "MISS $f"
done
```

Expected: every line printed starts with `OK`. If any line says `MISS`, fix the link in `README.md` (either remove the broken reference or correct the path) before continuing.

- [ ] **Step 5: Confirm no forbidden claims slipped in**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
grep -nE '(Alex is live|Alex is shipped|signed audit|cryptographically signed|production-deployed|in production today)' README.md || echo "no forbidden phrases"
```

Expected: `no forbidden phrases`. If `grep` returns matches, the README contradicts the audit ledger — soften the wording before committing.

- [ ] **Step 6: Render preview locally (optional but recommended)**

If `gh` is installed and authenticated:

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
gh markdown README.md 2>/dev/null | head -40 || echo "(gh markdown preview unavailable; skip)"
```

Otherwise open `README.md` in any GFM-aware viewer (VS Code preview pane, Obsidian, etc.) and confirm:
- Headings render at the expected levels
- The architecture SVG embeds (not a broken-image icon)
- The wedge table renders as three rows with status labels
- Code fences render as monospaced blocks

- [ ] **Step 7: Stage and commit**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git branch --show-current  # confirm: docs/readme-refresh
git add README.md
git commit -m "docs(readme): rewrite as operator-led github front door"
```

---

## Task 3: Final verification and PR-readiness

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm both commits landed on the right branch**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git log --oneline origin/main..HEAD
```

Expected: three commits — the spec commit (already there), the SVG commit, and the README rewrite commit. All on `docs/readme-refresh`.

- [ ] **Step 2: Diff against `origin/main` to make sure scope is README only**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git diff --stat origin/main..HEAD
```

Expected: only `README.md`, `docs/assets/architecture.svg`, `docs/superpowers/specs/2026-05-01-readme-refresh-design.md`, and `docs/superpowers/plans/2026-05-01-readme-refresh.md`. **No code, schema, or test files.** If anything else appears, stop and investigate.

- [ ] **Step 3: Final commit of the plan itself (if not already committed)**

```bash
cd /Users/jasonli/switchboard/.worktrees/readme-refresh
git status --short
```

If `docs/superpowers/plans/2026-05-01-readme-refresh.md` shows as untracked or modified:

```bash
git add docs/superpowers/plans/2026-05-01-readme-refresh.md
git commit -m "docs(readme): add implementation plan for README refresh"
```

- [ ] **Step 4: Hand off to user for github.com preview**

Tell the user the branch is ready and give them the option to either:
- Push and open a draft PR for github.com to render the README, or
- Review locally first and push when satisfied.

Do not push without explicit user approval.

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

- Hero, three wedges, "why outperforms," How It Works (SVG + ASCII), For Contributors, Docs index, License → all in Task 2's README content.
- SVG asset → Task 1.
- Verification of claim ledger (no forbidden phrases) → Task 2 Step 5.
- Worktree branch context check → repeated before each commit.
- Out-of-scope items (badges, screenshots, CONTRIBUTING split, creativeagent integration) → not added; Task 3 Step 2 verifies scope.

**Placeholder scan** — none. Every step contains either an exact command, exact code, or an exact file write. No "TBD," "TODO," "fill in," or "similar to."

**Type / wording consistency** — wedge status labels (`Alpha`, `Production-grade`, `Planned`) match between the spec, the README table, and the README badges. Architecture component names (`PlatformIngress`, `GovernanceGate`, `WorkTrace`, `ExecutionMode`) match across the SVG, the README prose, and the spec. The forbidden-phrase grep regex matches the audit ledger's "claims we will not make."
