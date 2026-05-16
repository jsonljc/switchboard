# Cockpit Wiring Runbook

How to flip the two kill-switched feature flags that gate /alex and /riley
behaviors, plus the Meta Ads / Google Calendar Connection prerequisite for
the KPI spend tile and mission setup checklist.

> **Read first:** "Upstream-writer gap" below describes a discovery from the
> 2026-05-16 cockpit wiring audit that affects how the live data path works.
> Flipping env flags will not make KPI spend tiles or the calendar setup row
> show real data until the upstream writer ships. Read that section before
> flipping anything.

## Upstream-writer gap (read this first)

`apps/api/src/routes/agent-home/mission.ts` and
`apps/api/src/lib/meta-spend-provider.ts` query the `Connection` table for
rows with `serviceId === "meta-ads"` or `serviceId === "google-calendar"`.
**As of 2026-05-16, no production code automatically creates these rows.**

The OAuth callbacks `apps/api/src/routes/facebook-oauth.ts` and
`apps/api/src/routes/google-calendar-oauth.ts` write to a different table
(`DeploymentConnection` with column `type`, NOT `Connection.serviceId`).
The two tables are separate models in the Prisma schema (`schema.prisma:196`
vs `schema.prisma:1206`); the mission/spend reads have no awareness of
`DeploymentConnection`.

**Today, the only way to populate the `Connection` rows that
mission.ts/meta-spend-provider read** is via the generic
`POST /api/connections` endpoint (`apps/api/src/routes/connections.ts:19`).
This is a manual API call — no UI surfaces it. Until either the OAuth
callbacks are extended to dual-write or mission/spend are re-pointed at
`DeploymentConnection`, the KPI spend tile and the calendar/meta setup
rows will remain blank/off regardless of what env flags are flipped.

**Tracked follow-up:** dual-write `Connection` rows from
`facebook-oauth.ts` and `google-calendar-oauth.ts` (or alternatively
re-point mission.ts + meta-spend-provider.ts at `DeploymentConnection`).
Out of scope for the current cockpit wiring PR.

## Prerequisites for live data on KPI spend tile

KPI spend tile renders "—" until ALL of the following are true:

1. `apps/api/src/app.ts` decorates `metaSpendProvider` (shipped — see PR
   that landed this runbook).
2. The org has a `Connection` row with `serviceId: "meta-ads"` and
   `status: "connected"`. **Today this requires a manual `POST /api/connections`** —
   see "Upstream-writer gap" above.
3. The Connection's stored credentials decrypt cleanly. If decryption
   throws, the provider logs a warn and returns null (tile stays "—").

## Prerequisites for live calendar setup row

The Alex mission setup checklist's calendar row ticks "done" only when
a `Connection` row with `serviceId: "google-calendar"` AND
`status: "connected"` exists. The strict `=== "connected"` semantic
keeps a degraded row from prematurely marking the step done. The
existing meta-ads row uses a laxer `!!metaConnection` semantic; this
asymmetry is intentional for the current PR and tracked as a separate
follow-up to align both reads.

As with the spend tile, populating the `Connection` row today requires
the manual API path (see "Upstream-writer gap").

## Flag 1: `NEXT_PUBLIC_APPROVALS_LIVE`

**What it gates:** Alex approvals on /alex switch from in-app fixtures
to live API data. Real `payload.kind` rendering (rich card variants per
kind) depends on Critical #3 also shipping — until then, live rows
arrive with `payload.kind === undefined` and the dashboard's rich
adapter falls through to the legacy adapter, which silently classifies
every approval as "pricing". The flag flip alone is still a strict
improvement (real summary, real expiresAt, real bindingHash, real
respond-mutation contract); just don't expect kind variants until #3
lands.

**Where:** Vercel dashboard env vars. Set
`NEXT_PUBLIC_APPROVALS_LIVE=true` in the Production environment AND
trigger a fresh build (the value is inlined at build time — runtime
overrides will not take effect).

**Verification after flip + rebuild:**

1. Open /alex as an authenticated operator with at least one pending
   ApprovalRequest in the DB.
2. Network tab: `/api/dashboard/approvals` should return rows with
   real `bindingHash` and `expiresAt` matching the DB row (not the
   fixture values like `apr_2f1a08`).
3. Approval card "Accept" submits a real mutation that updates the
   ApprovalRequest row in Postgres (verify via DB query before/after).
4. Card kind variant: expect generic "pricing" copy on every row
   until Critical #3 producer-side wire ships. Rich kind variants
   (refund / regulatory / safety-gate / escalation / qualification)
   are NOT a function of this flag alone.

**Rollback:** Set `NEXT_PUBLIC_APPROVALS_LIVE=false` (or unset) and
rebuild. The page reverts to fixture mode.

## Flag 2: `RILEY_OUTCOME_ATTRIBUTION_ENABLED`

**What it gates:** The daily 07:00 UTC outcome-attribution worker
(`apps/api/src/services/cron/riley-outcome-attribution.ts:44`) actually
runs vs. short-circuits to `{ skipped: "disabled" }`. When enabled,
Riley pause/refresh recommendations get attribution rows written to the
`RecommendationOutcome` table; these surface on /riley as "observed"
ActivityRow entries with allowlisted directional copy.

**Where:** Render dashboard env vars (per repo doctrine — apps/api runs
on Render). Set `RILEY_OUTCOME_ATTRIBUTION_ENABLED=true` on the API
service. No rebuild needed — runtime env read at `inngest.ts:644`.

**Pre-flip smoke checklist:**

1. At least one Riley recommendation in DB with `intent` in the
   pause-or-refresh allowlist.
2. The recommendation must be ≥7 days old (the worker's lookback
   window).
3. Meta insights for that campaign must be fetchable (Connection
   credentials valid).

**Verification after flip:**

1. Wait for the next 07:00 UTC fire OR trigger manually via Inngest
   console.
2. Check Inngest run logs: expect `{ skipped: undefined }` not
   `{ skipped: "disabled" }`.
3. Query `SELECT count(*) FROM "RecommendationOutcome" WHERE
"createdAt" > now() - interval '1 hour'`. Expect > 0.
4. Open /riley activity feed. Expect at least one row with kind
   `"observed"` and directional copy (e.g. "Pause reduced CPL ~15%").

**Rollback:** Set `RILEY_OUTCOME_ATTRIBUTION_ENABLED=false` (or unset).
Worker reverts to skip-immediately on the next cron fire. Existing
outcome rows are preserved.

## Out-of-scope: Critical #3 (kind classification producer wire)

The dashboard, API, Prisma store, and `ApprovalRequest.payload` schema
all already accept `payload.kind`. The orchestrator
(`packages/core/src/orchestrator/{propose,plan}-pipeline.ts` +
`apps/api/src/routes/approval-factory.ts`) never WRITES the field
because no path from `ToolResult.error.payload` reaches the
ApprovalRequest construction site. Closing this gap requires a
brainstorming pass to identify the right producer seam — flipping
`NEXT_PUBLIC_APPROVALS_LIVE` alone will surface live approvals with
`undefined` kind, which the dashboard's rich adapter handles by
falling back to the legacy adapter (silently classifies as "pricing").

Track separately as "Critical #3 — kind classification producer wire."

## Follow-ups discovered during this PR

The cockpit wiring punch-list PR (4 commits) closes the read-side gaps
but leaves these as separately tracked follow-ups:

1. **Connection-table dual-write from OAuth callbacks** (highest
   leverage). Extend `facebook-oauth.ts` and `google-calendar-oauth.ts`
   to also write `Connection` rows (`serviceId: "meta-ads"` and
   `serviceId: "google-calendar"` respectively) when they write
   `DeploymentConnection`. Alternative: re-point mission.ts and
   meta-spend-provider.ts at `DeploymentConnection`. Without one of
   these, the read-side wiring this PR ships has no live data source.
2. **`metaDone` strict-semantic alignment**. `mission.ts:109` currently
   uses `!!metaConnection`. Task 3 applied the stricter `=== "connected"`
   semantic to calendar only to avoid scope creep. Align both reads in
   a future PR for honest setup-checklist semantics.
3. **`serviceId` constants module**. `"meta-ads"` and `"google-calendar"`
   are now load-bearing integration contracts scattered across the
   codebase. Long-term: introduce `SERVICE_IDS.META_ADS` /
   `SERVICE_IDS.GOOGLE_CALENDAR`. Don't introduce the abstraction
   prematurely.
4. **Critical #3 — kind classification producer wire**. See above.
5. **Riley `body` slot on `RileyApprovalView`** — Riley adapter writes
   `humanSummary → quote` and never sets `body`. ApprovalCard supports
   both slots. Revisit when a Riley card design explicitly calls for
   a body line.
6. **Alex accent prop backport** to `<KPIStrip>` and `<ApprovalCard>` —
   visual no-op today (Alex defaults already match token fallbacks).
   Defensive consistency only; YAGNI for the cockpit wiring PR.
