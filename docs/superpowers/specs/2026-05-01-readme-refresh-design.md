# README Refresh — Design

**Date:** 2026-05-01
**Branch:** `docs/readme-refresh`
**Worktree:** `.worktrees/readme-refresh`
**Scope:** Rewrite root `README.md` for github.com visitors. Operator-led front door, contributor section preserved. No code changes.

## Goal

The current `README.md` (179 lines) is a dense engineering reference. It does not explain *what Switchboard is for*, *who it is for*, or *why an operator should care*. We want a github.com front door that:

1. Tells an operator (prospective customer) what Switchboard does and why it outperforms a human team in the same role.
2. Tells a prospective contributor where the code is and how to run it.
3. Stays honest — every claim is grounded in code that exists today, not aspirational.

## Audience

Lead with operators / customers. Link out to a "For Contributors" section partway down. Both audiences land on the same README; neither is forced to scroll past the other's content.

## Audit-grounded claim ledger

Before drafting prose, the codebase was audited (worktree `.worktrees/readme-refresh` off `origin/main`). Findings determine what we can and cannot say.

### Three Revenue Wedges — verified status

| Wedge | Claim we can make | Source of truth |
|---|---|---|
| **Lead-to-Booking (Alex)** | Alpha — actively under hardening. WhatsApp ingress + Google Calendar tool wired; three known P0 launch blockers tracked in `.audit/`. **Do not call "live" or "shipped."** | `apps/chat/src/adapters/whatsapp.ts`, `packages/core/src/skill-runtime/tools/calendar-book.ts`, `packages/core/src/skill-runtime/builders/alex.ts`, `apps/api/src/bootstrap/skill-mode.ts:210-216` (builder not yet registered) |
| **Ad Optimization** | Production-grade. Real Meta CAPI + Google Offline Conversions integration, lead ingestion, funnel + saturation analysis, Inngest cron flows. | `packages/ad-optimizer/src/` — `MetaAdsClient`, `MetaCAPIClient`, `MetaCAPIDispatcher`, `google-offline-dispatcher.ts`, `meta-leads-ingester.ts`, `inngest-functions.ts` |
| **PCD (Product / Character / Director)** | Planned wedge. UGC pipeline scaffolding (Kling provider, scene casting, scripting, realism QA) lives in `packages/creative-pipeline`. **Full character-consistent agents live in a separate repo (`~/creativeagent`) and will be integrated later.** | `packages/creative-pipeline/src/` (UGC flows present); no character/director state in switchboard yet |

### Architecture invariants — all verified real

| Claim | Verified at |
|---|---|
| `PlatformIngress.submit()` normalizes WorkUnits and enforces idempotency via dedup against `WorkTraceStore` | `packages/core/src/platform/platform-ingress.ts:83`, `:94-127`, `:191` |
| `GovernanceGate.evaluate()` resolves identity + policy + risk + approval routing in one place | `packages/core/src/platform/governance/governance-gate.ts:81`, `:95-99` |
| `WorkTrace` is persisted on every execution via a store abstraction (not a direct Prisma model — `WorkTraceStore` interface) | `packages/core/src/platform/work-trace.ts`, `platform-ingress.ts:326-370` |
| Audit trail is tamper-evident via SHA-256 content hash + audit-anchor binding (no signatures, no blockchain — append-only with hash chain) | `packages/core/src/platform/work-trace-hash.ts`, `work-trace-integrity.ts:47-75` |
| `ExecutionMode` is real code: `skill`, `pipeline`, `cartridge`, `workflow`, `operator_mutation` | `packages/core/src/platform/types.ts:1-6` |
| Human approval mid-flight with binding-hash anti-tamper | `packages/core/src/approval/lifecycle-service.ts:29,69,90`, `state-machine.ts` |

### Quick Start — all accurate

- `./scripts/setup-env.sh` exists.
- `pnpm db:migrate` and `pnpm db:seed` are valid root scripts (`package.json:17-18`).
- Ports: api 3000, chat 3001, dashboard 3002 — confirmed in each app.
- Seed credential `admin@switchboard.local / admin123` — confirmed `packages/db/prisma/seed.ts:99-100`.
- `pgvector` is actually used — `schema.prisma:595` (`Unsupported("vector(1024)")`).

### Claims we will NOT make

- "Alex is live in production." (P0 blockers; builder not registered.)
- "WorkTrace is a Prisma model." (It's persisted via store abstraction.)
- "Full PCD / character agents." (That work lives in `~/creativeagent` and is not integrated yet.)
- "Cryptographically signed audit trail." (Hash-chain only; no signatures.)
- "Switchboard automatically emails customers calendar invites." (Local calendar provider is database-only; only the Google Calendar provider sends invites.)

## README structure (final)

```
1. Hero
2. Three Revenue Wedges (status badges)
3. Why Switchboard Outperforms Human Operators
4. How It Works (SVG diagram + existing ASCII flow)
5. For Contributors
   5a. Project Structure
   5b. Dependency Layers
   5c. Quick Start (prereqs, setup, dev, db, docker)
   5d. Testing
6. Docs & Further Reading
7. License
```

### 1. Hero

One sentence + 2–3 line elaboration. Tagline: **"Governed operating system for revenue actions."**

Elaboration explains: every business action — booking a lead, optimizing ad spend, producing a creative — flows through one control plane with governance, audit trail, idempotency, and human override built in.

### 2. Three Revenue Wedges

Three short cards in a row (or stacked on mobile via plain markdown):

- **Lead-to-Booking (Alex)** — Alpha. WhatsApp inbound → governed booking → Google Calendar.
- **Ad Optimization** — Production-grade. Meta + Google integrations, automated budget and creative recommendations through governance.
- **Product / Character / Director (PCD)** — Planned. Character-consistent creative across Sora / Veo / Runway / Kling / HeyGen. Currently developed in [`~/creativeagent`](https://github.com/jsonljc/creativeagent) (separate repo); integration into Switchboard targeted for a later release.

Each card carries a status label (`Alpha`, `Production-grade`, `Planned`) so a visitor reads honest state at a glance. "Production-grade" describes code maturity, not deployment status — we will not imply deployment unless deployed.

### 3. Why Switchboard Outperforms Human Operators

7 bullets, each tied to an architectural fact (so it's defensible, not marketing fluff):

- **24/7 sub-second latency** — channel adapters answer inbound in seconds, not the hours it takes a human inbox.
- **Nothing slips through the cracks** — every action becomes a `WorkUnit` and lands in `WorkTrace`. No forgotten follow-ups, no "I missed that DM."
- **Consistent judgment at scale** — `GovernanceGate` applies the same policy to action #1 and action #10,000. Humans drift, get tired, and apply rules unevenly.
- **Parallelism across wedges** — one platform runs lead booking, ad optimization, and (soon) creative production concurrently. A human team needs three specialists plus a coordinator.
- **Faster learning loop** — every decision is hashed, anchored, and outcome-linked. Policy improvements compound. Tribal knowledge doesn't walk out the door.
- **Compliance built in** — tamper-evident audit trail (`work-trace-integrity.ts`) and first-class human-override paths (`approval/lifecycle-service.ts`) mean speed *without* losing accountability. Most "AI agents" trade one for the other.
- **Cost structure** — fixed and declining marginal cost per action vs. linear headcount cost. (Quantify when we have data — leave qualitative for now.)

Tone: confident, specific, defensible. Each bullet names the architectural fact behind the claim.

### 4. How It Works

- New: `docs/assets/architecture.svg` — simple 5-box SVG (Channel → PlatformIngress → GovernanceGate → ExecutionMode → WorkTrace). Plain styling, no fancy gradients. Embedded with `<img>` tag.
- Keep: existing ASCII control-plane flow diagram. It's good and reads in any markdown viewer including the GitHub mobile app.
- Two-paragraph "What's Live" block: short, honest summary of what works end-to-end today (ad-optimizer pipeline, Alex alpha) and what's planned (PCD integration).

### 5. For Contributors

A clearly-headed section, mostly compressed from the existing README:

- **5a. Project Structure** — keep current tree.
- **5b. Dependency Layers** — keep current text + ASCII; verified accurate.
- **5c. Quick Start** — prereqs (Node 20+, pnpm 9, Postgres 17/18 + pgvector, Redis optional), setup commands, dev commands, working with the database, docker.
- **5d. Testing** — keep current commands.

If this section grows past ~150 lines after drafting, split to `docs/CONTRIBUTING.md` and leave a 1-paragraph summary in README. Decision deferred until the draft.

### 6. Docs & Further Reading

Linked list:

- `docs/DOCTRINE.md` — architectural rules
- `docs/ARCHITECTURE.md` — deeper architecture
- `docs/OPERATIONS.md` — runbook
- `docs/DEPLOYMENT-CHECKLIST.md` — deploy checklist
- Future: `~/creativeagent` repo for PCD work.

### 7. License

MIT. (Unchanged.)

## Files created / changed

- `README.md` — rewritten (~250–350 lines target).
- `docs/assets/architecture.svg` — new, hand-rolled, ~5 boxes, plain.
- `docs/assets/.gitkeep` — only if `docs/assets/` doesn't exist.

## Out of scope

- shields.io badges (deferred — user did not request).
- Dashboard screenshots (deferred — user did not request).
- Splitting to `docs/CONTRIBUTING.md` (only if README grows past ~150 lines after draft).
- Any actual integration of `creativeagent` into switchboard (this spec is README only).
- Any code, schema, or test changes.

## Risks

- **Drift risk:** Wedge status changes weekly. The README will go stale fast. Mitigation: status labels are coarse (`Alpha` / `Production` / `Planned`) so they tolerate minor changes; revisit each release.
- **Alex framing:** Calling Alex "Alpha" instead of "Live" is the right call honesty-wise but may surprise operators who saw earlier marketing. Acceptable trade-off — we'd rather under-promise and ship.
- **PCD framing:** Pointing operators at a separate repo (`~/creativeagent`) telegraphs that integration isn't done. Honest; matches reality.

## Acceptance

- README renders cleanly on github.com (preview before merge).
- Every wedge / architecture / quick-start claim traces back to a file path in the audit ledger above.
- "Why we outperform humans" reads confident-but-grounded, not marketing fluff.
- Existing contributor content remains discoverable for engineers landing on the repo.
