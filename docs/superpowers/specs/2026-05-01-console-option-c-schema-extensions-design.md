# Console Option C — DashboardOverview Schema Extensions

**Status:** Draft
**Date:** 2026-05-01
**Scope:** `packages/schemas` (DashboardOverview), `apps/api/src/routes/dashboard-overview.ts`, `packages/db` (new stores + 2 new tables for C2), `packages/ad-optimizer` (1 new Inngest function for C2), `apps/dashboard/src/components/console/console-mappers.ts` (consumes the new fields).
**Continues:** [`2026-04-30-console-as-home-dashboard-design.md`](./2026-04-30-console-as-home-dashboard-design.md), section "Phasing → Option C".
**Does not supersede:** the parent spec stays the source of truth for the overall direction; this spec narrows in on the schema shape and the data sources.

## Background

Option B (PR #328) wired `/console` to the data the backend already exposes. Three of five number-strip cells, every per-agent today-stat, the approval-gate stage progress, the Nova ad-set table, and per-row agent attribution on activity all stayed muted (`—`) or fixture-shaped. Option C extends `DashboardOverview` so the Console can render real data for the rest.

After brainstorming on 2026-05-01 we narrowed the original 7 spec fields to 6. The seventh — `recommendationConfidence` — is **deferred to a separate spec** because it's a product-contract question (insight vs. draft action vs. governed `ActionRequest`), not a dashboard wiring question. See _Open questions_ below.

## Goal

Extend `DashboardOverview` so:

- The Console's 5-cell numbers strip can render real values for **revenue, spend, reply time** (in addition to the leads + appointments cells already wired in option B).
- Each per-agent strip cell (Alex / Nova / Mira) reads its today-stats directly from the schema instead of synthesized strings.
- Approval-gate cards render `Stage 2 of 5` and a real countdown.
- The Nova expanded panel renders real ad-set rows aggregated across enabled deployments, with a cross-link to any pause-pending draft.
- Activity rows carry a structured `agent: AgentKey | null` instead of a string parsed out of the description.

## Non-goals

- The Nova-drafts feed (Recommendation queue cards). Deferred to a separate "Nova Draft Recommendations Feed" spec (working title C3 / E). The Console keeps recommendation cards empty/hidden until that spec lands.
- Tab-nav consolidation (`Decide` / `Escalations` removal). That's option D, separate spec.
- Per-agent module page (`/modules/*`) redesigns.
- Currency conversion. The schema assumes one currency per org for today-scoped totals; multi-currency aggregation is out of scope. See _Open questions_.
- Real-time-pacing accuracy on `today.spend`. The 15-min cadence is sufficient for an operating-control surface.
- Governance changes. No work in `packages/core`.

## Locked decisions from brainstorm (2026-05-01)

| # | Decision |
|---|----------|
| Q1 | One spec covering all 6 fields, two implementation phases (**C1** = Tier A, data exists; **C2** = Tier B, needs new ingestion). |
| Q2 | `today.revenue` = recorded payments today (`PrismaRevenueStore.sumByOrg` with today's window). |
| Q3 | `today.replyTime` = median of `(firstReplyAt − createdAt)` over conversations where `createdAt >= todayStart` AND `firstReplyAt` exists AND `(firstReplyAt − createdAt) <= 24h`. Yesterday baseline = same cohort definition shifted one day. |
| Q4 | `today.spend` = sum of `AdSpendDaily` rollup rows for today across enabled deployments; populated by a 15-min Inngest job (today-only, idempotent upsert). Dashboard reads are fast and always return last-known data. |
| Q5 | Per-agent stats are nullable. `agentsToday.{alex,nova,mira} = null` ⇔ that agent's module is disabled. The Console pairs with `useModuleStatus` for the inactive treatment. |
| Q6 | Stage progress lives **inline** on each `approvals[]` row as `stageProgress?: { stageIndex, stageTotal, stageLabel, closesAt }`. Optional; only present on creative-pipeline approvals. |
| Q7 | `novaAdSets` sourced from a new `AdSetDailyMetrics` rollup populated by the same Inngest job that fills `AdSpendDaily`. Top 5 by today's spend across enabled deployments. |
| Q8 | `recommendationConfidence` **deferred** to a separate spec. Reason: introducing a parallel `recommendations[]` queue alongside `approvals[]` is a governance-semantics question, not a dashboard-data question. |

## Schema shape — Approach 2 (namespaced)

Time becomes a first-class dimension via the new `today.*` block. Per-agent today-stats live under a parallel `agentsToday.*` block. Two existing fields move out of `stats` into the new structure (one-time migration; only the option-B mapper consumes them today).

```ts
// packages/schemas/src/dashboard.ts (post-C)

export const AgentKeySchema = z.enum(["alex", "nova", "mira", "system"]);
export type AgentKey = z.infer<typeof AgentKeySchema>;

export const AdSetRowSchema = z.object({
  adSetId: z.string(),
  adSetName: z.string(),
  deploymentId: z.string(),
  spend: z.object({ amount: z.number(), currency: z.string() }),
  conversions: z.number(),
  cpa: z.number().nullable(),
  trend: z.enum(["up", "down", "flat"]),
  status: z.enum(["delivering", "learning", "limited", "paused"]),
  /** True when an approval with kind=pause_ad_set is pending against this row. Drives the cross-link pin. */
  pausePending: z.boolean(),
});
export type AdSetRow = z.infer<typeof AdSetRowSchema>;

export const StageProgressSchema = z.object({
  stageIndex: z.number().int().nonnegative(),
  stageTotal: z.number().int().positive(),
  stageLabel: z.string(),
  closesAt: z.string().nullable(),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;

export const DashboardOverviewSchema = z.object({
  generatedAt: z.string(),
  greeting: z.object({ period: z.enum(["morning", "afternoon", "evening"]), operatorName: z.string() }),

  // Existing — leads-today + bookings-today move out of `stats` into `today`.
  stats: z.object({
    pendingApprovals: z.number(),
    qualifiedLeads: z.number(),
    revenue7d: z.object({ total: z.number(), count: z.number() }),
    openTasks: z.number(),
    overdueTasks: z.number(),
  }),

  // ── NEW: today snapshot ────────────────────────────────────────────────
  today: z.object({
    /** Recorded payments today. amount=0 is a real value (operator hasn't sold anything yet). */
    revenue: z.object({
      amount: z.number(),
      currency: z.string(),
      /** % vs trailing 7-day daily average. null when no comparable history. */
      deltaPctVsAvg: z.number().nullable(),
    }),

    /** Sum of AdSpendDaily rows for today. amount=0 when no deployments / no spend yet. */
    spend: z.object({
      amount: z.number(),
      currency: z.string(),
      /** % of account spend-cap reached today. 0 when no cap configured. */
      capPct: z.number(),
      /** ISO of last successful Inngest sync. null when zero deployments or never synced. */
      updatedAt: z.string().nullable(),
    }),

    /** Median first-reply latency for conversations created today, capped at 24h SLA window. null when sampleSize=0. */
    replyTime: z.object({
      medianSeconds: z.number(),
      /** Same cohort definition shifted one day. null when yesterday had no signal. */
      previousSeconds: z.number().nullable(),
      sampleSize: z.number().int().nonnegative(),
    }).nullable(),

    leads: z.object({ count: z.number().int().nonnegative(), yesterdayCount: z.number().int().nonnegative() }),

    appointments: z.object({
      count: z.number().int().nonnegative(),
      next: z.object({ startsAt: z.string(), contactName: z.string(), service: z.string() }).nullable(),
    }),
  }),

  // ── NEW: per-agent today-stats. null ⇔ module disabled. ─────────────────
  agentsToday: z.object({
    alex: z.object({
      repliedToday: z.number().int().nonnegative(),
      qualifiedToday: z.number().int().nonnegative(),
      bookedToday: z.number().int().nonnegative(),
    }).nullable(),

    nova: z.object({
      /** Redundant with today.spend for the single-Nova case; kept here so the agent panel doesn't cross-section join. */
      spendToday: z.object({ amount: z.number(), currency: z.string() }),
      draftsPending: z.number().int().nonnegative(),
    }).nullable(),

    mira: z.object({
      inFlight: z.number().int().nonnegative(),
      winningHook: z.string().nullable(),
    }).nullable(),
  }),

  // ── NEW: top-5 ad-set rows for the Nova expanded panel. Empty when nova module disabled or zero spend today. ──
  novaAdSets: z.array(AdSetRowSchema),

  // Existing approvals — gains an optional inline stageProgress on creative-risk rows.
  approvals: z.array(z.object({
    id: z.string(),
    summary: z.string(),
    riskContext: z.string().nullable(),
    createdAt: z.string(),
    envelopeId: z.string(),
    bindingHash: z.string(),
    riskCategory: z.string(),
    /** NEW: present only for creative-pipeline approvals. */
    stageProgress: StageProgressSchema.optional(),
  })),

  // Existing — unchanged from current schema; see packages/schemas/src/dashboard.ts:34-69.
  bookings: /* unchanged */,
  funnel: /* unchanged */,
  revenue: /* unchanged — 7d block */,
  tasks: /* unchanged */,

  // Existing activity — gains a structured agent field.
  activity: z.array(z.object({
    id: z.string(),
    type: z.string(),
    description: z.string(),
    dotColor: z.enum(["green", "amber", "blue", "gray"]),
    createdAt: z.string(),
    reasoning: z.string().nullable().optional(),
    /** NEW: structured agent attribution. null for system events / unattributable rows. */
    agent: AgentKeySchema.nullable(),
  })),
});
```

**Migration (one-time, no shim):**

- `stats.newInquiriesToday` → `today.leads.count`
- `stats.newInquiriesYesterday` → `today.leads.yesterdayCount`
- `stats.bookingsToday` → `today.appointments.count`
- The first item of the existing `bookings[]` (filtered to today, sorted ascending by `startsAt`) → `today.appointments.next`

Per `CLAUDE.md` doctrine: no backwards-compat keys. Option B's `console-mappers.ts` is the only consumer of these paths today; it gets updated alongside the schema in C1.

## Data sources by field

| Field | Tier | Source | Store / function |
| ----- | ---- | ------ | ----------------- |
| `today.revenue` | A | existing `Revenue` table | `PrismaRevenueStore.sumByOrg(orgId, todayWindow)` (already exists; new caller) + a second call for the 7-day average to compute `deltaPctVsAvg` |
| `today.replyTime` | A | `ConversationState.firstReplyAt` + `createdAt` | new query `PrismaConversationStateStore.replyTimeStats(orgId, day)` returning `{ medianSeconds, sampleSize }`; called twice (today + yesterday) for `previousSeconds` |
| `today.leads` | A | existing `ConversionRecord.type=inquiry` | reuse `countByType` (already exists; reshape into the new block) |
| `today.appointments` | A | existing `bookingStore.listByDate` | reuse the existing today-bookings call (already exists; reshape) |
| `agentsToday.alex` | A | existing conversion records + booking store | new query `alexStatsToday(orgId)` (or compose from `countByType` calls) |
| `approvals[].stageProgress` | A | creative-pipeline `CreativeJob` | new query `creativeJobStore.stageProgressByApproval(approvalIds)`; mapper joins by approval id |
| `activity[].agent` | A | audit ledger `actorType` + `actorId` | promote `activity-translator.ts:resolveActor` from a string to a structured `AgentKey \| null` |
| `today.spend` | B | new `AdSpendDaily` table | new `PrismaAdSpendDailyStore.sumByOrg(orgId, today)` |
| `agentsToday.nova` | B | `AdSpendDaily` + new `draftsPending` count | reuse `AdSpendDaily`; new `actionRequestStore.draftsPending(orgId, agent="nova")` |
| `agentsToday.mira` | B | creative-pipeline jobs | new `creativeJobStore.miraStatsToday(orgId)` returning `{ inFlight, winningHook }` |
| `novaAdSets` | B | new `AdSetDailyMetrics` table | new `PrismaAdSetDailyMetricsStore.topByOrg(orgId, today, limit=5)`; the `pausePending` flag derives from a join against pending action-requests |

## New ingestion (Tier B / C2 only)

Two new tables + one new Inngest function. No changes to existing Meta API code.

### Tables (Prisma migration, lands in C2)

```prisma
model AdSpendDaily {
  id            String   @id @default(uuid())
  organizationId String
  deploymentId  String
  date          DateTime @db.Date  // account-timezone day boundary
  amount        Decimal  @db.Decimal(12, 2)
  currency      String
  updatedAt     DateTime @default(now()) @updatedAt
  createdAt     DateTime @default(now())

  @@unique([organizationId, deploymentId, date])
  @@index([organizationId, date])
}

model AdSetDailyMetrics {
  id            String   @id @default(uuid())
  organizationId String
  deploymentId  String
  date          DateTime @db.Date
  adSetId       String
  adSetName     String
  spend         Decimal  @db.Decimal(12, 2)
  currency      String
  conversions   Int
  cpa           Decimal? @db.Decimal(12, 2)
  trend         String   // "up" | "down" | "flat"
  status        String   // "delivering" | "learning" | "limited" | "paused"
  updatedAt     DateTime @default(now()) @updatedAt
  createdAt     DateTime @default(now())

  @@unique([organizationId, deploymentId, date, adSetId])
  @@index([organizationId, date, spend])
}
```

### Inngest function: `syncTodayAdMetrics`

- Cron: `*/15 * * * *` (every 15 minutes).
- For each org × enabled `ad-optimizer` deployment, fetch today's insights via the existing `meta-campaign-insights-provider`.
- Upsert today's `AdSpendDaily` row (overwrite, never increment — Meta returns running totals).
- Upsert today's `AdSetDailyMetrics` rows for each ad-set the provider returns.
- Failure handling:
  - Single-deployment failure: log to audit ledger as `connection.degraded`, continue with other deployments. Existing rows stay; dashboard returns last-known data.
  - Token-expired / OAuth failure: emit a `HEALTH` row signal (out-of-scope for this spec; the parent spec already routes that through `useModuleStatus`).
  - Total job failure: standard Inngest retry with exponential backoff; surface as a system audit row after 3 consecutive failures.
- Idempotency: every run is `INSERT ... ON CONFLICT (orgId, deploymentId, date[, adSetId]) DO UPDATE SET amount=EXCLUDED.amount, updatedAt=NOW()`. Re-running the same minute is safe.

## UI consequences in `console-mappers.ts`

Each new schema field maps to a precise mapper change. The view (`console-view.tsx`) doesn't change.

| Mapper | Change |
| ------ | ------ |
| `mapNumbersStrip` | Drops `placeholder: true` on the Revenue, Spend, and Reply-time cells. Each formats from the new `today.*` paths. Reply-time cell becomes muted again when `today.replyTime === null`. |
| `mapAgents` | Reads `agentsToday.alex` / `agentsToday.nova` / `agentsToday.mira` for primary + secondary stats. When a block is `null`, the cell renders the inactive treatment (deferred fuller "Hire X" UX to a future spec; for now: muted name, no stats, no `view →` link). |
| `mapApprovalGateCard` | When `stageProgress` is present, renders `Stage ${stageIndex} of ${stageTotal}` + `${stageLabel}` + countdown derived from `closesAt`. Falls back to current synthesized `"—"` when undefined. |
| **NEW** `mapNovaPanel` | Replaces the fixture-shaped `consoleFixture.novaPanel` with `novaAdSets` rows. The cross-link pin renders only when at least one row has `pausePending=true`; clicking scrolls to the corresponding queue card. |
| `mapActivity` | Reads `entry.agent` directly. The synthesized `agentForAction(action, actorId)` helper from option B is removed — the structured field replaces it. |

## Failure & null semantics

**Per-field rules:**

- `today.revenue.amount = 0` is a real value, not an absence. Cell renders `$0` with neutral delta. The block is non-nullable.
- `today.spend.amount = 0` is a real value when zero deployments are enabled or no spend has occurred today. The block is non-nullable. `updatedAt` semantics drive the cell's display state:
  - `updatedAt = null` ⇔ no successful sync ever (rollup table empty, or — during C1 — the rollup table doesn't exist yet). The Console renders the cell as `placeholder: true` (muted `—`).
  - `updatedAt` set but more than 30 minutes old ⇔ stale data; the Console adds a subtle "X min ago" footer but still renders the value.
  - `updatedAt` set within the last 30 minutes ⇔ fresh; cell renders normally.
- `today.replyTime` is `null` when `sampleSize = 0` (no conversations created today, or none have firstReplyAt yet). Cell goes muted with `—`.
- `agentsToday.{alex,nova,mira}` is `null` ⇔ that agent's module is disabled (Q5). Cell renders the inactive treatment.
- `approvals[].stageProgress` is `undefined` for non-creative-pipeline approvals. Mapper renders the option-B synthesized fallback.
- `activity[].agent` is `null` for system events or unattributable rows. Cell renders `SYSTEM`.
- `novaAdSets` is `[]` when the Nova module is disabled or no ad-sets had spend today. Console hides the expanded panel.

**Whole-endpoint failure** is unchanged from option B: the existing dashboard hook composer keeps the fixture-fallback during loading + renders the error banner above the view when any underlying hook errors.

## Phasing

### C1 — Tier A: data already exists

**One PR to `main`. Builds on top of merged option B.**

Schema delta:

- Adds `today.{revenue, replyTime, leads, appointments}`, `agentsToday.alex`, `approvals[].stageProgress`, `activity[].agent`, `AgentKey`, `AdSetRow`, `StageProgress` types.
- Tier B fields shipped with placeholder values: `today.spend = { amount: 0, currency: orgCurrency, capPct: 0, updatedAt: null }`, `agentsToday.nova = null`, `agentsToday.mira = null`, `novaAdSets = []`.
- Migrates `stats.newInquiriesToday/Yesterday` and `stats.bookingsToday` out of `stats` into `today.*`.

Builder + stores:

- New stores / queries: `replyTimeStats`, `alexStatsToday`, `creativeJobStore.stageProgressByApproval`.
- Activity translator: structured `agent` field on every row.
- `buildDashboardOverview` adds the new query calls to its `Promise.all`.

Dashboard:

- `console-mappers.ts` rewires Revenue / Reply-time cells, Alex agent cell, approval-gate card stage progress, activity-row agent attribution.
- Mapper tests updated; new builder tests added; Zod parse round-trip tests for the new shape.

**Acceptance:**

- 4 of 5 number cells render real data. Spend stays muted with "pending C2".
- Approval-gate cards render real `Stage X of Y` + countdown.
- Activity rows render `ALEX` / `NOVA` / `MIRA` / `SYSTEM` from the structured field.
- Alex agent strip cell renders real today-stats.
- Nova + Mira agent cells stay "pending C2".
- `pnpm typecheck` + `pnpm test` clean across all touched packages.

### C2 — Tier B: rollups + Inngest job

**One PR to `main`. Builds on C1.**

Migration: `AdSpendDaily` + `AdSetDailyMetrics` tables (new file under `packages/db/prisma/migrations`), with `pnpm db:check-drift` clean.

New code:

- `packages/db/src/stores/prisma-ad-spend-daily-store.ts` + tests
- `packages/db/src/stores/prisma-ad-set-daily-metrics-store.ts` + tests
- `packages/ad-optimizer/src/sync-today-ad-metrics.ts` (Inngest function) + tests covering: idempotent upsert, partial-deployment failure, token-expired audit row, retry semantics
- New queries on existing stores: `creativeJobStore.miraStatsToday`, `actionRequestStore.draftsPending`
- `buildDashboardOverview` lights up `today.spend`, `agentsToday.nova`, `agentsToday.mira`, `novaAdSets`

Dashboard:

- New `mapNovaPanel` mapper replaces the fixture; tests cover empty / single-row / 5-row / pause-pending cases.
- `mapAgents` lights up Nova + Mira cells.
- `mapNumbersStrip` lights up Spend cell (drops `placeholder: true`).

**Acceptance:**

- All 5 number cells render real data.
- Nova expanded panel renders real ad-sets with cross-link to pause-pending approvals.
- Nova + Mira agent cells render real today-stats.
- Inngest function runs successfully against staging Meta deployments; data appears in rollup tables; subsequent dashboard fetches reflect it.
- Failure modes verified: single-deployment Meta failure doesn't block the whole sync; idempotent re-run is safe; token-expired emits the right audit signal.
- `pnpm typecheck` + `pnpm test` + `pnpm db:check-drift` clean.

## Testing

Per `CLAUDE.md`, every new module gets co-located `*.test.ts`. Coverage targets: dashboard 55/50/52/55, schemas inherits global.

- **`packages/schemas`** — Zod parse round-trip for the full new shape; per-field nullability + optionality coverage.
- **`apps/api`** — `buildDashboardOverview` test fixtures cover: empty org (zero records, zero deployments, zero conversations), partial-data org (Alex active but Nova disabled), full-data org (all three agents, all blocks populated), and the Tier B failure modes (rollup table empty / stale / missing today's row).
- **`packages/db`** — store implementations get round-trip tests against an in-memory or SQLite-backed Prisma client per existing patterns.
- **`packages/ad-optimizer`** — `syncTodayAdMetrics` tests cover: happy path, partial deployment failure, idempotent re-run, token-expired audit emission.
- **`apps/dashboard`** — option-B's 21 mapper tests rebase to read from the new schema paths. New tests: `mapNovaPanel` rendering matrix; numbers-strip placeholder-removal cases; `mapApprovalGateCard` with and without `stageProgress`; activity-row agent attribution from structured field.

## Open questions

- **Multi-currency orgs.** If a single org has ad-optimizer deployments in different currencies, `today.spend.amount` becomes ambiguous. C2 will assume one currency per org (canonicalized via `useOrgConfig().config.currency`). If a deployment's currency disagrees, the Inngest job logs a warning and skips that deployment's spend in the org-level total. A future spec can add ingestion-time conversion via a configurable rate. **Lean: defer multi-currency entirely until a real operator hits it.**
- **Inactive-agent (`Hire X`) treatment.** Spec calls for it but its visual design is deferred. C1 ships a minimal muted state; the fuller "Hire Alex" / "Hire Nova" surface is its own design exercise.
- **`today.revenue.deltaPctVsAvg` baseline window.** Currently spec'd as "trailing 7-day daily average." Reasonable default; revisit if operators want week-over-week instead.
- **Recommendation cards** — explicitly deferred. The follow-on spec ("Nova Draft Recommendations Feed", working title C3 / E) needs to answer: are drafts insights (read-only) or actions (governed via `ActionRequest`)? The likely direction is `NovaRecommendationDraft → optionally promoted to ActionRequest → approval pipeline`, but that's a governance-semantics design, not a dashboard one.

## Sequencing

Per `CLAUDE.md`: specs land on `main` via focused PRs; this spec is its own PR. C1 and C2 each get their own implementation plan via the writing-plans skill, each landing as its own PR.

C1 cannot start until option B (PR #328) merges, because C1's mapper rewrite builds on B's `console-mappers.ts`.

## Loose ends from prior session (housekeeping, not in scope)

- **PR #328** carries 2 unrelated orphan files in commit `139fc568` (`.audit/_session-handoff.md`, `docs/superpowers/specs/2026-04-29-pricing-and-website-direction-design.md`). Recommendation: squash-merge with edited message, or interactive rebase to drop them before merge.
- The empty `.worktrees/dashboard-design` directory is orphaned. Safe to remove with `git worktree prune`.
