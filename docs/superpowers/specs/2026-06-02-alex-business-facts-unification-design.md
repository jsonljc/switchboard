# Spec — Unify BusinessFacts source of truth (Alex T0.1)

- **Date:** 2026-06-02
- **Status:** design (approved-with-tweaks → writing-plans)
- **Branch / worktree:** `fix/alex-business-facts-unify` (off `origin/main` @ `c213e370`)
- **Audit:** `docs/audits/2026-06-02-alex-improvement-audit/` — finding **T0.1**; execution-plan **Open Decision #1**
- **PR title:** `fix(alex): unify business facts source of truth`
- **Framing:** a **live-path correctness repair**, not a new BusinessFacts feature.

## Problem

Operator-entered medspa BusinessFacts (hours / pricing / services / parking / policies) never reach Alex. Verified on current `main`:

- **Consumer (live read):** `alexBuilder` → `PrismaBusinessFactsStore.get(orgId)` reads `BusinessConfig.config` (per-org). `packages/db/src/stores/prisma-business-facts-store.ts:7-13`.
- **Producer (write):** the dashboard's `upsertBusinessFacts` PATCHes `AgentDeployment.inputConfig.businessFacts` (per-deployment). `apps/dashboard/src/lib/api-client/marketplace.ts:83-91`.
- The two tables never meet. Worse, the rich-facts producer is **orphaned**: no live UI calls `upsertBusinessFacts` (only an orphaned Next route `…/marketplace/deployments/[id]/business-facts/route.ts`; no `BusinessFactsForm` is mounted). The onboarding "business facts step" writes a **different, smaller** schema (`PlaybookBusinessFactsSchema`: serviceArea/USPs) to `organizationConfig.onboardingPlaybook` — never read by Alex.
- `BusinessConfig` has **no seed and no non-test writer** (`PrismaBusinessFactsStore.upsert` has zero product callers).
- Two in-lane defects: `renderBusinessFacts` omits `bookingPolicies.advanceBookingDays` (`packages/core/src/skill-runtime/context-resolver.ts`); `PrismaBusinessFactsStore.get` does an unvalidated `row.config as unknown as BusinessFacts` cast, so a malformed row throws inside `renderBusinessFacts` and fails the whole turn.

**Impact:** fresh/real orgs start with empty facts. By Alex's Bucket-B rule (`skills/alex/SKILL.md:138`), he must escalate every hours/pricing/services/parking question — the highest-frequency inbound class. Alex launches functionally mute on its most common turn.

## Decisions (locked in brainstorming + spec review)

1. **Canonical source of truth = `BusinessConfig.config` (per-org).** It is already the live read target; clinic facts are genuinely org-level (not per-deployment); the table already exists; and the live reader/builder need **no change** — which also keeps this slice off `builders/alex.ts`.
2. **Scope = backend unification + seed + backfill + a NON-blocking readiness warning.** A live operator rich-facts editor is an explicit **fast-follow**. Rationale: there is no live rich-facts entry surface today, so a _blocking_ readiness gate with no editor would deadlock real orgs at go-live. The seed makes demo/eval orgs non-mute now; the warning surfaces the gap without blocking.
3. **Backfill = a versioned, idempotent SQL data-migration** (guarded fill — see below). `BusinessConfig` already exists, so there is **no schema migration**, only data.
4. **Keep strict `validate-or-null`** at the runtime read boundary (no separate lenient "stored" schema). Only _structural_ fields fail parse (`businessName`, ≥1 `location`, `openingHours`, ≥1 `service`, `escalationContact`); optional detail (parking/price/policies) already does not fail and the renderer tolerates absence. So strict-or-null degrades only _structurally broken_ blobs, where "no facts + escalate" beats a half-empty block Alex might treat as authoritative. Seed and the fast-follow editor always write complete objects; the readiness `malformed` reason makes incompleteness visible.

## Current base reality (post-#799 / #794)

`origin/main` advanced mid-design. **PR-A #799** (`c4834e16`, live-turn correctness) and **#794** (`c213e370`, conversion-polish) are now merged and are this branch's base.

- **#799 modified `builders/alex.ts`** — it hoisted `facts` to function scope because the new **current-date anchor now also reads `facts.timezone`**: `const rawTz = facts?.timezone ?? "Asia/Singapore"` with a `try/catch` on invalid IANA strings (`builders/alex.ts:98-136`). The builder is therefore **already null-safe for facts**, so this slice's `safeParse → null` change is transparent, and populating real facts is _synergistic_ (the date anchor gets the correct org timezone). **This slice does not modify `builders/alex.ts`.** (The redundant `as BusinessFacts | null` cast there is left as-is to keep the diff off a hot file.)
- **#799 did NOT touch** this slice's surface: `prisma-business-facts-store.ts` (still the unvalidated cast), `context-resolver.ts` (still omits `advanceBookingDays`), `readiness.ts`, the marketplace route, or the seed. Scope is intact.
- **#794 is disjoint** (metrics, opportunity store, eval harness, SKILL objection copy). No overlap.
- Production-path test precedent to mirror: `packages/core/src/skill-runtime/__tests__/alex-persona-live-path.test.ts`.

## Store API (the shared seam)

`PrismaBusinessFactsStore` gains a status-aware reader so runtime, the API, and readiness all classify the same way:

- `getWithStatus(orgId): Promise<{ facts: BusinessFacts | null; status: "present" | "missing" | "malformed"; issues?: ZodIssueSummary[] }>` — fetch the row, classify: no row / `config == null` / `config === {}` → `missing`; row present but `BusinessFactsSchema.safeParse` fails → `malformed` (with a sanitized `issues` summary); parses → `present` (with `facts`).
- `get(orgId): Promise<BusinessFacts | null>` (runtime) — delegates to `getWithStatus`; on `malformed` emits the **sanitized** warn and returns `null`; otherwise returns `facts`. The builder path is unchanged.
- `upsert(orgId, facts)` — unchanged; becomes live via the new route.

Reused by: the GET route (`{ config, status }`) and `buildReadinessContext` (the `present|missing|malformed` reason). Only `get()` warns (per-turn); the route and readiness do not, so readiness checks don't spam logs.

## Design — changes by file

All additive/redirecting; respects dependency layers (schemas → core → db → apps). **No `builders/alex.ts` change. No `SKILL.md` change.**

| Concern                      | File                                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Graceful degrade**         | `packages/db/.../prisma-business-facts-store.ts`                                  | Add `getWithStatus`; `get()` delegates and emits the sanitized warn on `malformed` → return `null` (replacing the unchecked cast). `upsert()` unchanged.                                                                                                                                                                                                                                                                                           |
| **Render fix + wording**     | `packages/core/.../context-resolver.ts`                                           | `renderBusinessFacts` emits `advanceBookingDays` as non-promissory context: `Advance booking: up to {n} days ahead (subject to availability)`.                                                                                                                                                                                                                                                                                                     |
| **Canonical writer + authz** | `apps/api/src/routes/marketplace.ts`                                              | New `GET`/`PUT /deployments/:id/business-facts`. Resolve the deployment; assert it belongs to the **route's authenticated org** (same auth mechanism the sibling deployment routes use); **write keyed to that authed org, never a caller-supplied id**; reject cross-org with 404. `PUT` validates `BusinessFactsSchema` (400) → `store.upsert(orgId, facts)`. `GET` → `{ config, status }`. Includes a code comment (below). No skill-type gate. |
| **Writer redirect**          | `apps/dashboard/.../api-client/marketplace.ts` + Next `…/business-facts/route.ts` | Repoint `upsertBusinessFacts`/`getBusinessFacts` to the new route (off `inputConfig`). Must pass `pnpm --filter @switchboard/dashboard build`; imports omit `.js`.                                                                                                                                                                                                                                                                                 |
| **Seed**                     | `packages/db/prisma/seed-marketplace.ts`                                          | Write a **complete, realistic** Singapore medspa `BusinessFacts` blob (all required fields + `advanceBookingDays`) to `BusinessConfig` for the seeded org via `prisma.businessConfig.upsert`. Scrub PII / vertical drift.                                                                                                                                                                                                                          |
| **Backfill**                 | `packages/db/prisma/migrations/<ts>_backfill_business_facts/migration.sql`        | Guarded, idempotent SQL (below). No schema change → `db:check-drift` stays clean.                                                                                                                                                                                                                                                                                                                                                                  |
| **Readiness (non-blocking)** | `apps/api/src/routes/readiness.ts` (+ `buildReadinessContext`)                    | Add `business-facts-present` mirroring `checkAlexSkillPackSeeded` but **`blocking: false`**. Context uses `getWithStatus` → `businessFactsStatus: present \| missing \| malformed`, surfaced in the warning `message`. Appears on **activate and resume** (shared `checkReadiness`).                                                                                                                                                               |

### Route code comment (required)

To stop a future maintainer from "fixing" this back into per-deployment facts:

```
// BusinessFacts are org-level clinic facts. The :id (deployment) is used ONLY
// to anchor org ownership through the existing marketplace auth model; the
// write is keyed to the authenticated org, never to caller-supplied input.
```

## Data flow (after)

- **Write:** operator (fast-follow editor / production-path test) → `PUT …/deployments/:id/business-facts` → org-ownership check → `BusinessFactsSchema.parse` → `store.upsert(orgId)` → `BusinessConfig.config`.
- **Read (live, unchanged):** `alexBuilder` → `store.get(orgId)` → `safeParse` → `renderBusinessFacts` → `BUSINESS_FACTS` prompt param → Alex answers Bucket-B instead of escalating. (`facts.timezone` also feeds the `CURRENT_DATETIME` anchor.)

## Backfill migration (guarded fill)

Copy `AgentDeployment.inputConfig->'businessFacts'` → `BusinessConfig.config`, per org, with safety:

- **Insert** a `BusinessConfig` row when none exists for the org.
- **Update** only when the existing canonical `config` is `NULL` or `'{}'::jsonb` (fill empties).
- **Never clobber** a non-empty canonical row.
- **`RAISE NOTICE`** for any org where _both_ a non-empty canonical row and a non-empty `inputConfig.businessFacts` exist — but treat this as a secondary signal only.
- Supply `id` (`gen_random_uuid()`), `createdAt`, `updatedAt` (raw SQL; Prisma defaults are app-side; verify `gen_random_uuid()` availability or `CREATE EXTENSION IF NOT EXISTS pgcrypto`).
- **No schema validation in SQL** (the read path owns that); malformed canonical rows are neutralized at read time (`safeParse → null`) and re-entered via the editor.

In practice the producer was orphaned, so ≈0 rows match — this is defensive. It runs once at deploy (`migrate deploy`); orgs created afterward get facts via the route/seed.

**Post-deploy conflict query (goes in the PR description, not relied on via NOTICE alone):**

```sql
SELECT d."organizationId"
FROM "AgentDeployment" d
JOIN "BusinessConfig" b ON b."organizationId" = d."organizationId"
WHERE d."inputConfig" -> 'businessFacts' IS NOT NULL
  AND d."inputConfig" -> 'businessFacts' <> '{}'::jsonb
  AND b."config" IS NOT NULL
  AND b."config" <> '{}'::jsonb;
```

Empty result = clean migration; any rows = manual reconciliation needed.

## Error handling / degradation

Malformed or structurally-incomplete `config` → `safeParse` fails → `get()` returns `null` + a **sanitized** warn → `BUSINESS_FACTS=""` and the date anchor uses `FALLBACK_TZ`. No raw error, no crash; Alex falls back to its existing Bucket-B polite escalation.

The warn is actionable but **PII-safe** — org id + Zod issue paths/codes only, never the raw config (which holds phones, addresses, escalation contacts):

```
console.warn("[BusinessFacts] malformed BusinessConfig.config", {
  organizationId,
  issues: result.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
});
```

(A Prometheus empty-facts counter is PR-0 territory.)

## Testing (TDD)

- **Core live-path test (keystone)** — `packages/core/src/skill-runtime/__tests__/alex-business-facts-live-path.test.ts`, mirroring `alex-persona-live-path.test.ts`: real `alexBuilder` + in-memory `businessFactsStore` returning operator facts → assert `parameters.BUSINESS_FACTS` contains hours / price / `advanceBookingDays`.
- **DB store test** — `packages/db` (mocked Prisma): valid → `present` + facts; `{}`/missing → `missing` + null; malformed → `malformed` + null + sanitized warn (no throw, no raw-config dump).
- **Render test** — `packages/core`: `advanceBookingDays` present/absent + exact non-promissory wording.
- **API route test** — `apps/api`: valid `PUT` persists via `store.upsert(authedOrg, …)`; **cross-org `:id` rejected (404)**; invalid facts → 400; `GET` round-trips with `status`.
- **API store→builder span** — `apps/api` (mocked Prisma): real store + real `alexBuilder` → assert `BUSINESS_FACTS`. If `alexBuilder` isn't exported from `@switchboard/core`, fall back to a store→`renderBusinessFacts` span; the core live-path test remains the keystone.
- **Readiness test** — `apps/api`: present → pass; missing → fail w/ `missing` reason; malformed → fail w/ `malformed` reason; in all cases `report.ready` stays `true` (non-blocking), on activate and resume contexts.
- **No-legacy-writer guard** — assert (test or PR-validation grep) that no product code writes `inputConfig.businessFacts` after the redirect (see acceptance #11).
- **Backfill** — idempotency + no-clobber-of-valid + fill-empty; SQL hand-validated against local Postgres before commit (CI has no Postgres → DB-touching unit assertions follow the mocked-Prisma convention).

This slice adds the live-path test for the BusinessFacts capability, satisfying the execution-plan's production-path-integration-test invariant.

## Commit sequencing (for the plan / reviewer path)

1. **store + renderer** — `getWithStatus` + sanitized `get()`; render `advanceBookingDays`; unit tests.
2. **API + dashboard redirect** — new `GET`/`PUT` route (+ comment); Next proxy/client repoint; authz/cross-org tests; dashboard build.
3. **seed + migration + readiness** — medspa blob; guarded SQL backfill; non-blocking readiness check.
4. **live-path tests** — core builder prompt test + apps/api store→builder/render span.

## Out of scope (YAGNI / follow-up)

- Live operator rich-facts editor UI (immediate fast-follow; it must consume the status-aware `GET` so it can distinguish missing vs malformed).
- Making the readiness gate blocking (after the editor exists).
- The separate `PlaybookBusinessFactsSchema` / onboarding-facts flow (different, smaller schema — untouched to avoid conflation).
- The eval harness (PR-0, gated behind #794 work).
- A Prometheus empty-facts metric counter (PR-0).
- Any `builders/alex.ts` / `SKILL.md` change.

## Coordination / risk

- Base includes #799 and #794 (both merged); disjoint from both, from `feat/alex-cadence-reminders`, and from `feat/alex-live-turn-correctness` (now merged as #799). No shared files except the additive `marketplace.ts` route.
- No schema migration → `db:check-drift` clean. Data-only migration is hand-written (no TTY) and validated against local Postgres.
- **Highest-risk implementation point is the API route authz** (deployment-scoped URL writing org-scoped config), then the hand-written migration, then the dashboard import conventions — covered by the tests above.

## Acceptance criteria

1. Facts written through `PUT …/deployments/:id/business-facts` persist to `BusinessConfig.config` keyed by the **authed** org.
2. A cross-org deployment id is **rejected** (404), not written.
3. `GET …/business-facts` returns `{ config, status }` where `status ∈ {present, missing, malformed}`.
4. The live `alexBuilder` receives those facts through the real store path (core live-path test **and** apps/api store→builder span).
5. `advanceBookingDays` appears in rendered `BUSINESS_FACTS` with non-promissory wording.
6. A malformed `config` returns `null`, warns **without dumping raw config**, and does not throw or fail the turn.
7. Readiness shows a **non-blocking** warning distinguishing `missing` vs `malformed`, on activate **and** resume; `report.ready` is unaffected.
8. The seeded org has a complete, realistic medspa facts blob.
9. The backfill is idempotent and never overwrites a valid canonical row; the PR description includes the post-deploy conflict query.
10. Green: `pnpm build`, `pnpm typecheck` (20/20), `pnpm test`, `pnpm format:check`, `pnpm db:check-drift`, and `pnpm --filter @switchboard/dashboard build`.
11. No product code writes `inputConfig.businessFacts` after the redirect — verified by `rg "inputConfig.*businessFacts"` showing only the expected remainders (the backfill migration's read; type/schema defs; tests). Adapter writes for `adAccountId`/`pixelId` are unaffected.
