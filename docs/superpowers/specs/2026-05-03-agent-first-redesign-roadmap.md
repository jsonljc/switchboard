# Agent-First Redesign — Implementation Roadmap (handoff)

**Status:** Brainstorm in progress — paused for fresh-session pickup.
**Date:** 2026-05-03
**Scope:** Translate the existing design briefs (`2026-05-03-agent-home-design.md`, `2026-05-03-reports-design.md`, `2026-04-29-pricing-and-website-direction-design.md`) into a backend + frontend implementation track list, with ordering and a recommended first slice. This is **not** a final design spec — it is the working scoping document for the next session to start from.

---

## How to use this document (fresh-session reader)

1. Read this doc top-to-bottom — it is self-contained.
2. The design briefs in `docs/superpowers/specs/2026-05-03-{agent-home,reports}-design.md` are the visual + product thesis. This doc is the implementation roadmap that derives from them.
3. When you reach **§9 First slice to brainstorm**, that is your starting point: invoke the `superpowers:brainstorming` skill on Slice A (agent roster + decision feed bundle), follow the normal flow, end with a written design spec at `docs/superpowers/specs/YYYY-MM-DD-agent-roster-and-decision-feed-design.md`.
4. The recommendations backend v1 (PRs #356, #357, merged 2026-05-03) is the load-bearing prior work. About 60% of the backend infrastructure for the agent home is already shipped. §6 is the inventory of what's done vs. new.

---

## 1. The corrections that triggered this handoff

The prior session's roadmap had three problems. These are now locked.

### 1.1. Canonical agent names are **Alex / Riley / Mira** (locked, no more changes)

| Agent     | Role           | Accent                             | Status          |
| --------- | -------------- | ---------------------------------- | --------------- |
| **Alex**  | lead-to-speed  | Marketing orange `hsl(20 90% 55%)` | Launch day      |
| **Riley** | ad-optimizer   | Warm clay `hsl(15 45% 50%)`        | Launch day      |
| **Mira**  | creative / PCD | Ink violet `hsl(265 30% 35%)`      | Launch +30 days |

### 1.2. `/reports` is launch-priority, not Phase E

The Tools-tier work register (per agent-home spec §18) was missing from the prior roadmap. `/reports` is the renewal checkpoint at $300-600/mo + variable pricing (per `2026-05-03-reports-design.md` §1: "the renewal checkpoint, not a dashboard"). It must ship in the launch sequence alongside the agent homes — not deferred. The other Tools surfaces (`/contacts`, `/automations`, `/activity`) can defer.

### 1.3. Decision feed must aggregate **three** sources, not two

Approvals + Escalations + **Handoffs**. Per the agent-home design, the inbox drawer + per-agent "Needs You" block surfaces:

- **Approvals** (recommendations) — `PendingActionRecord` rows with `intent LIKE 'recommendation.%'`
- **Escalations** (low-confidence replies, human-handoff requests) — `EscalationRecord` rows
- **Handoffs** (SLA-driven, package-builder) — `Handoff` rows (NB: "handoff" in this context is the SLA-tracked CRM artifact, distinct from the term "handoff" used elsewhere)

The decision feed is a discriminated union over `kind: "approval" | "escalation" | "handoff"`, all mapped through `mapToDecisionCard()` in the dashboard.

---

## 2. Naming reconciliation tasks (cleanup, must complete before Slice A)

Three places in the codebase still use stale names. Lock these first.

| File                                                                        | Current                                                                                   | Target                                                                             |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/dashboard/src/components/character/agent-mark.tsx:3`                  | `AgentId = "alex" \| "riley" \| "jordan"`                                                 | `"alex" \| "riley" \| "mira"`                                                      |
| `apps/dashboard/src/components/character/agent-mark.tsx:7-11`               | `SLUG_TO_AGENT["nurture-specialist"] = "jordan"`; `AGENT_DISPLAY_NAMES.jordan = "Jordan"` | `SLUG_TO_AGENT["creative-director"] = "mira"`; `AGENT_DISPLAY_NAMES.mira = "Mira"` |
| `packages/schemas/src/recommendations.ts:25`                                | `AgentKeySchema = z.enum(["nova", "alex", "mira"])`                                       | `z.enum(["alex", "riley", "mira"])`                                                |
| `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md` | uses `Nova`                                                                               | rename `Nova` → `Riley` (Mira already correct)                                     |

**New file to create as the single source of truth:**
`packages/schemas/src/agents.ts` exporting:

```ts
export const AGENT_REGISTRY = {
  alex: {
    key: "alex",
    role: "lead-to-speed",
    displayName: "Alex",
    accent: "hsl(20 90% 55%)",
    launchTier: "day-one",
  },
  riley: {
    key: "riley",
    role: "ad-optimizer",
    displayName: "Riley",
    accent: "hsl(15 45% 50%)",
    launchTier: "day-one",
  },
  mira: {
    key: "mira",
    role: "creative",
    displayName: "Mira",
    accent: "hsl(265 30% 35%)",
    launchTier: "day-thirty",
  },
} as const;
export type AgentKey = keyof typeof AGENT_REGISTRY;
```

Both consumers (the schema enum + the dashboard component) re-export from this file. No more parallel definitions.

The codebase rename is a small first PR (≈30-40 line diff). It MUST land before Slice A's brainstorm starts so the brainstorm references stable names.

---

## 3. Two registers (lock from agent-home spec §2 and §18)

The whole product runs at two visual registers, picked by surface, never mixed within one screen.

| Register                                                | Surface                                                                       | Reference                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| **Editorial** (display serif, magazine spread, prose)   | Agent homes (`/[agent]`), decision cards, recent wins, marketing pages        | _The New Yorker_, Substack reader, Granola recaps |
| **Mercury / Work** (sans-led numerals, hairline tables) | Tools-tier: `/reports`, `/contacts`, `/automations`, `/activity`, `/settings` | Mercury banking dashboard, Stripe Atlas           |

**Test for any new screen:**

- Does the agent _speak_ here? → editorial
- Does the founder _work_ here? → Mercury

This determines fonts, layout, density, and component palette per surface.

---

## 4. Frontend phases

### Phase A — foundations (block everything)

- **A1.** Naming reconciliation + `packages/schemas/src/agents.ts` registry (see §2)
- **A2.** `OrgAgentRegistry` read endpoint (`GET /api/dashboard/agents`) returning per-org enabled agent list
- **A3.** Per-agent home shell + folio-strip header + ambient cream + fonts (Source Serif 4, Inter, JetBrains Mono) + tokens

### Phase B — fill the agent home (each block independently shippable)

- **B1.** Greeting block (prose + portrait, variant computer)
- **B2.** Needs You block (Decision Card UI consuming the unified Decision feed)
- **B3.** Recent Wins block (wins feed + undo affordances)
- **B4.** This Week block (hero number + sparkline + 3 stat cells)
- **B5.** Pipeline block (horizontal-scroll tiles)

### Phase B+ — Reports (parallel to B, not after)

- **B+1.** `/reports` Mercury surface (per `2026-05-03-reports-design.md`)
- Hero = single agent-voice sentence framing value vs. cost
- Sections: Value attributed, Funnel, Cost-vs-value, Pull-quote, PDF export

### Phase C — global surfaces

- **C1.** Inbox drawer overlay (cross-agent decisions, accessible from header)
- **C2.** Live mode overlay (current `/console` accessible as a header toggle)

### Phase D — Tools tier + migration cleanup

- **D1.** `/contacts` (Mercury register, master CRM list)
- **D2.** `/automations` (Mercury, workflow rules)
- **D3.** `/activity` (Mercury, audit log)
- **D4.** Disposition of old routes — `/dashboard`, `/escalations`, `/decide`, `/tasks`, `/me`, `/my-agent`, `/modules`, `/conversations`, `/deployments` — fold-into-agent-home / drill-down / delete per-route decisions
- **D5.** Migration coexistence behind `useAgentFirstNav` feature flag (decided 2026-05-03)

### Phase E — separate tracks (don't block A–D)

- **E1.** ✅ Public marketing site three-wedge redesign — shipped via PR #426 (Nova→Riley), PR #430 (marketing truth-up), and the polish PR for this work.
- **E2.** Onboarding reframe (does it become "pick agents to enable" or stay single-agent-first?)

---

## 5. Backend tracks (with what's already shipped)

The recommendations backend v1 (PRs #356 + #357, merged 2026-05-03) was deliberately surface-agnostic and pre-builds substantial portions of the agent-home backend. Inventory:

| Track                                        | What's shipped                                                                                                                                                                                                                                      | What's still needed                                                                                                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#1 Agent roster registry**                 | `agentKey` exists in recs + schemas; surface-agnostic by design                                                                                                                                                                                     | Reconcile 3 naming conventions (§2); build `AGENT_REGISTRY` const; add `OrgAgentRegistry` per-org read endpoint                                                                                                                                                          |
| **#2 Decision feed** (Needs You)             | ✅ `PendingActionRecord` w/ `surface`/`undoableUntil`/`__recommendation` namespace; `GET /api/recommendations` per surface; act-side w/ 5 verbs; 409 silent-success; multi-org isolation; idempotency. Recommendations are already a Decision kind. | **Aggregate 3 sources**: extend with escalations + handoffs adapters. New endpoint `GET /api/dashboard/agents/:key/decisions` returning discriminated union `kind: "approval" \| "escalation" \| "handoff"`. Inbox aggregator is the same endpoint without agent filter. |
| **#3 Wins feed**                             | ✅ Acted/dismissed/confirmed recs already have `humanSummary` + `actedAt` + `actionTaken`; terminal status in `PendingActionRecord` is queryable                                                                                                    | New endpoint `GET /api/dashboard/agents/:key/wins?since=24h` filtering terminal recs; layer in bookings/conversions later. Per-win undo affordances for non-rec sources                                                                                                  |
| **#4 Per-agent metrics rollup** (This Week)  | Nothing direct from recs                                                                                                                                                                                                                            | New: `GET /api/dashboard/agents/:key/metrics?period=week` aggregating `Booking`, `Opportunity`, `ConversionRecord`, `LifecycleRevenueEvent`, `LlmUsageLog` per-agent definitions. Sparkline data series.                                                                 |
| **#5 Pipeline projection**                   | `Contact`, `ContactLifecycle`, `Opportunity` exist                                                                                                                                                                                                  | New: per-agent stage classifier (Alex = lead pipeline, Riley = ad-set pipeline, Mira = creative pipeline). `GET /api/dashboard/agents/:key/pipeline`                                                                                                                     |
| **#6 Editorial prose generator**             | ✅ Pattern established in `recommendation-sink.ts:humanizeRecommendation`; `humanSummary` + `dataLines` are first-person editorial copy                                                                                                             | Extend pattern to escalations, handoffs, wins from non-rec sources, greeting variants, pipeline ctx. Per-agent voice profiles (Alex warm/conversational, Riley direct/numerical, Mira creative/aspirational). Cache at write-time.                                       |
| **#7 Inbox aggregator**                      | Same projection as #2                                                                                                                                                                                                                               | Trivial — same endpoint variant without agent filter                                                                                                                                                                                                                     |
| **#8 Greeting variant computer**             | Nothing                                                                                                                                                                                                                                             | Tiny pure function over signal (count of pending decisions, top item urgency, time since last operator action) → variant key                                                                                                                                             |
| **#9 Live signal**                           | n/a                                                                                                                                                                                                                                                 | Visual-only for v1 (just polling indicator); SSE/WebSocket deferred                                                                                                                                                                                                      |
| **#10 Route migration**                      | n/a                                                                                                                                                                                                                                                 | Backend cleanup only after consumers stop reading old endpoints                                                                                                                                                                                                          |
| **#11 `/reports` value-attribution rollup**  | Nothing                                                                                                                                                                                                                                             | New: per-agent attributed pipeline value (revenue × close-prob × first-touch attribution) using `Opportunity` + `LifecycleRevenueEvent` + `ConversionRecord`                                                                                                             |
| **#12 `/reports` funnel aggregation**        | Nothing                                                                                                                                                                                                                                             | New: impressions → clicks → leads → bookings, joining ad-optimizer audit data with conversation/booking data                                                                                                                                                             |
| **#13 `/reports` cost-vs-value computation** | Nothing                                                                                                                                                                                                                                             | New: reads Stripe billing per period + emits "saving $X vs SDR + agency" math                                                                                                                                                                                            |
| **#14 `/reports` pull-quote generator**      | Pattern from #6                                                                                                                                                                                                                                     | New: structured narrative from value/cost/notable-events, extends prose-generator pattern. THIS is the "single agent-voice sentence" hero.                                                                                                                               |
| **#15 `/reports` PDF export endpoint**       | Nothing                                                                                                                                                                                                                                             | New: server-side render of `/reports` as PDF                                                                                                                                                                                                                             |
| **#16 `useAgentFirstNav` feature flag**      | Nothing                                                                                                                                                                                                                                             | New: org-level or user-level flag that gates the new nav. Old routes keep working until flag flips per user.                                                                                                                                                             |

### Net effect

- **~60% of agent-home backend (Needs You, Wins, prose pattern) is already done.**
- **0% of `/reports` backend is done.** This is the largest remaining lift after #6 prose extension.
- **The schema migration footprint is small** — most new work is read-side projections layered over existing tables.

---

## 6. Recommended ordering (incorporating the corrections)

```
A1. Naming reconciliation + AGENT_REGISTRY const           [tiny, BLOCKS all]
A2. OrgAgentRegistry read endpoint                         [small]
A3. Per-agent home shell + header + tokens                 [medium]
─────────────────────────────────────────────────────────
B2. Decision feed (3-source aggregator) + Needs You block  [largest single lift in B]
B3. Wins feed (terminal recs first) + Recent Wins block    [medium]
B+1. /reports Mercury surface (with #11–#15 backends)      [PARALLEL with B — launch-priority]
B1. Greeting block (depends on B2 counts)                  [small]
B5. Pipeline block (independent of B2/B3)                  [small-medium]
B4. This Week block (per-agent metrics, last)              [medium]
─────────────────────────────────────────────────────────
C1. Inbox drawer (trivial after B2)                        [small]
C2. Live mode overlay                                      [small]
─────────────────────────────────────────────────────────
D1–D3. Tools tier (Mercury) /contacts /automations /activity
D4–D5. Migration cleanup behind useAgentFirstNav flag
─────────────────────────────────────────────────────────
E1. Marketing 3-wedge homepage              [parallel track, not blocking]
E2. Onboarding reframe                      [parallel track]
```

### Critical-path observations

- **A1+A2 are a single small PR.** ~30-40 line diff. Must land before B starts.
- **B2 (Decision feed) is the largest B-phase backend lift** but builds directly on recs v1 — extending the existing read endpoint with two more source adapters.
- **B+1 (Reports) runs in parallel with B**, not after. Two operators can work both tracks if available.
- **B1 (Greeting) depends on B2** — the variant computer reads decision counts. Sequence after B2.
- **B4 (Metrics) is last in B** — per-agent metric definitions need product input that B2/B3 reveal.

---

## 7. Migration posture (decided 2026-05-03)

**Coexist, not cut over.** Both navigations live behind a `useAgentFirstNav` feature flag (org-level for v1, may move to user-level later):

- `useAgentFirstNav = false` (default for existing orgs) → old routes keep working
- `useAgentFirstNav = true` (default for new orgs after launch day) → new agent-first nav active
- Old routes redirect to agent home equivalents only when the flag is on
- API endpoints keep working under both flag states; deletion is post-D5 only

This gives a soft cutover, lets us ship per-block, and prevents a big-bang regression risk.

---

## 8. Open questions to resolve in the first slice's brainstorm

The next session will brainstorm Slice A. These questions need explicit answers in that brainstorm:

1. **`AGENT_REGISTRY` shape** — final fields (key, role, displayName, accent, launchTier, portrait reference?). Does it carry capabilities (booking, ad-management, creative-pipeline) or are those derived elsewhere?
2. **`OrgAgentRegistry` storage** — new Prisma table, or extend `AgentRoster` / `AgentDeployment`? The 4 existing agent tables already have overlapping responsibilities. Reconciliation question.
3. **Per-org agent enablement** — does Mira show up as a stub on day one (with "Launching +30" copy) or only after enable? Same question for any future agents.
4. **Slug map** — `agent-mark.tsx:7-11` maps `"speed-to-lead" → "alex"`. The new design uses `/[agent]` directly (`/alex`, `/riley`). Are slugs deprecated, or kept as URL-safe aliases?
5. **Decision feed adapter shape** — does each source (recommendations, escalations, handoffs) carry the SAME prose fields (`humanSummary`, `dataLines`, `presentation`), or does the adapter project from source-specific fields into a unified shape at read time? Affects how heavy the projection is.
6. **Decision-feed urgency score** — what determines order across kinds? Recs have `confidence` + `dollarsAtRisk`; escalations have `priority` + `slaDeadlineAt`; handoffs have `slaDeadlineAt`. Single scoring function vs. per-kind weights.
7. **`useAgentFirstNav` flag scope** — org-level or user-level? Where does it live (existing org config table or new column)?

---

## 9. First slice to brainstorm

**Slice A: Naming reconciliation + Agent roster + Decision feed (3-source) — bundled.**

Rationale:

- Naming reconciliation (§2) is a hard blocker for everything else.
- Agent roster registry endpoint is small and unblocks the per-agent home shell.
- Decision feed is the single largest backend lift in Phase B and the most direct extension of the recs v1 work just shipped — strikes while context is hot.
- Bundling them into one brainstorm avoids two near-back-to-back small specs and resolves the §8 questions in one pass.

**The brainstorm should produce:** `docs/superpowers/specs/YYYY-MM-DD-agent-roster-and-decision-feed-design.md` with:

- The `AGENT_REGISTRY` const shape (locked)
- The `OrgAgentRegistry` storage decision
- The decision-feed read endpoint contract + adapter strategy
- The urgency scoring function
- The migration plan for the 3 stale name locations
- The frontend hook + view-model shape (`Decision`, `mapToDecisionCard()`)

**Out of scope for Slice A:**

- The actual UI of the Decision Card (Phase B2 implementation)
- Wins feed (Slice B-Wins, separate brainstorm)
- Greeting/metrics/pipeline (separate slices)
- `/reports` (Slice Reports, separate brainstorm — runs in parallel)

---

## 10. References

### Design briefs (already on main)

- `docs/superpowers/specs/2026-05-03-agent-home-design.md` — Alex agent home page brief (Claude Design format). §2 thesis, §3 inheritance, §10 responsive, §10b header iconography, §18 work register.
- `docs/superpowers/specs/2026-05-03-reports-design.md` — `/reports` ROI surface brief.
- `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md` — pricing + website direction (still uses `Nova`, needs rename to `Riley`).

### Implementation specs / plans (already shipped)

- `docs/superpowers/specs/2026-05-03-recommendations-backend-v1-design.md` — recommendations v1 spec.
- `docs/superpowers/plans/2026-05-03-recommendations-backend-v1.md` — recommendations v1 implementation plan.
- PR #356 (docs) + PR #357 (impl) — recommendations v1 merged 2026-05-03.

### Source design package (Claude Design export)

- Extracted at `/tmp/alex-design/switchboard/` (lost on next reboot — re-fetch from the original URL if needed). Contents:
  - `README.md` — handoff instructions for coding agents
  - `chats/chat1.md` through `chat8.md` — conversation transcripts capturing intent
  - `project/alex-home/Alex Home.html` + `alex-home.css` + `alex-home.jsx` — the canonical Alex home prototype (5 blocks)
  - `project/dashboard/`, `project/audit*/`, `project/approvals/`, etc. — sibling prototypes for other surfaces

### Code locations to update during Slice A

- `apps/dashboard/src/components/character/agent-mark.tsx`
- `packages/schemas/src/recommendations.ts:25` (AgentKeySchema enum)
- `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md`
- New: `packages/schemas/src/agents.ts`

### Existing agent-related Prisma models (for reconciliation in Slice A)

- `AgentRoster` — `packages/db/prisma/schema.prisma:449`
- `AgentState` — `:467`
- `AgentDeployment` — `:921`
- `AgentRegistration` — `:871`
- `AgentListing` — `:891`

These 5 tables overlap; Slice A's brainstorm needs to decide whether `OrgAgentRegistry` is a new table, a view over these, or an extension of one.

---

## 11. How a fresh session should proceed

1. Read this doc end-to-end.
2. Read `docs/superpowers/specs/2026-05-03-agent-home-design.md` §1, §2, §3, §10b, §18 (skim the rest).
3. Read `docs/superpowers/specs/2026-05-03-reports-design.md` §1, §2, §3 (skim the rest).
4. Spot-check: confirm PR #357 actually merged and `packages/schemas/src/recommendations.ts:25` still exists with the `nova/alex/mira` enum.
5. Invoke `superpowers:brainstorming` skill on Slice A with this prompt:

   > Brainstorm Slice A from `docs/superpowers/specs/2026-05-03-agent-first-redesign-roadmap.md`: naming reconciliation + agent roster + 3-source decision feed (approvals + escalations + handoffs). Final canonical names are Alex/Riley/Mira (locked). Resolve all 7 open questions in §8 of the roadmap. End with a written design spec.

6. From there, proceed through the standard brainstorming → writing-plans → subagent-driven-development flow.

---

## 12. Why this handoff doc exists

The agent-first redesign spans ~16 backend tracks and 4–5 phases of frontend work. Even with ~60% of the backend pre-built by the recommendations v1 work, the remaining surface area is too large for a single brainstorm. The prior session's roadmap missed `/reports` (launch-priority) and undercounted the decision feed (3 sources, not 2). Capturing the corrected scope here lets the next session start from the right baseline rather than re-discovering the corrections mid-flight.

The first slice (A) is small enough to brainstorm in one session and unblocks everything else. After A ships, parallel tracks become possible (B + B+ in parallel), and the redesign progresses block-by-block instead of as a big-bang rewrite.
