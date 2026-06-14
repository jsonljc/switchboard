# F4 — Revenue-Proven Cross-Agent Learning Channel (Riley → Mira)

> Status: design spec. Closes audit finding **F4** of the 2026-06-10 Alex capability audit
> (`docs/audits/2026-06-10-alex-capability-audit/README.md`, §3 F4 + §5 loop diagram).
> Consumes the binding design in the slice-2 learning-loop spec §3.7
> (`docs/superpowers/specs/2026-06-04-mira-slice2-learning-loop-design.md`).
>
> Date: 2026-06-11. Base: `origin/main` @ `90cbeb25`. Author: Claude (autonomous session).
> Sequenced right after F3 per-org provisioning (PR #970, merged).

## 1. Goal

Close the **Riley → Mira** edge of the north-star revenue loop: a creative pattern that earned
_real attributed booked revenue_ gets promoted into a `revenue_proven` DeploymentMemory row, and
Mira's brief builder — **already wired to read it** — surfaces it so the next concept leans into
proven winners. Today `revenue_proven` has **zero writers**, so the wired Mira read is dead code.

This is the F4 closure: build the **writer** (the producer) and prove the **previously-dead read**
(`builders/mira.ts`) now surfaces it (the consumer), end to end.

## 2. Verified current state (grounded against `origin/main` @ 90cbeb25)

| Fact                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `revenue_proven` is a valid DeploymentMemory category; column is `String` (no enum migration)                                                                                                                                                                                               | `packages/schemas/src/deployment-memory.ts:7-22`                                                                                                                                                                   |
| `revenue_proven` has **zero create/incrementConfidence writers** in non-test source — only a READ                                                                                                                                                                                           | grep: writers absent; read at `packages/core/src/skill-runtime/builders/mira.ts:43,72-99`                                                                                                                          |
| Mira's brain builder reads `revenue_proven` from its **own** deployment via `listHighConfidence(orgId, deploymentId, 0.66, 3)` and renders matches of `/^revenue_proven:(polished\|ugc)_([a-z0-9_]+)$/` as `Measured winner in {mode} mode: {segment} (N sources)`                          | `builders/mira.ts:43,82-99,242-248,260,266,275`                                                                                                                                                                    |
| Memory is scoped per `(organizationId, deploymentId)`; `organizationId` is its own column                                                                                                                                                                                                   | `packages/db/src/stores/prisma-deployment-memory-store.ts:50-89`                                                                                                                                                   |
| A `CreativeJob.deploymentId` **equals** the org's Mira creative `AgentDeployment.id` (skillSlug `"creative"`, listing slug `"performance-creative-director"`); jobs are created against the resolved creative deployment                                                                    | `packages/db/src/seed/seed-mira-creative-deployment.ts:20,39-136`; `apps/api/src/services/workflows/creative-job-submit-workflow.ts` (`deploymentId: input.deploymentId`)                                          |
| `CreativeJob.pastPerformance` (typed `CreativePastPerformanceSchema`: `delivery`, `meta.spend`, `booked.{valueCents,count}`, `trueRoas`, `join.{metaCampaignId,metaVideoId}`, `asOf`, `window`) is populated by the real **creative-attribution worker**                                    | schema `packages/schemas/src/creative-job.ts:265-304`; producer `computePastPerformance` + worker `apps/api/src/services/cron/creative-attribution.ts:162-206,216-320`; kill-switch `CREATIVE_ATTRIBUTION_ENABLED` |
| `PrismaCreativeJobStore.listPublished(orgId)` returns `metaCampaignId != null` jobs (full rows incl. `mode`, `stageOutputs`, `ugcPhaseOutputs`, `pastPerformance`)                                                                                                                          | `packages/db/src/stores/prisma-creative-job-store.ts:227-232`                                                                                                                                                      |
| `extractCreativeDescriptor(stageOutputs\|ugcPhaseOutputs, mode) -> {mode, hookType, structureId?}`; `hookType ∈ {pattern_interrupt, question, bold_statement, none}`                                                                                                                        | `packages/creative-pipeline/src/creative-descriptor.ts:42`                                                                                                                                                         |
| The **taste sweep** is the exact write precedent: pure-bucket content, `findByCategoryAndCanonicalKey -> increment-or-create`, 500-cap eviction, **P2002 catch**, per-job watermark (`tasteCapturedAt`); cron, Class-E `onFailure`, **no kill-switch** (no external I/O, reversible writes) | `apps/api/src/services/cron/creative-taste-sweep.ts:32-44,120-190,201-287`                                                                                                                                         |
| Riley's `RevenueState` (`measurementTrusted`, `signalHealthScore`) is assembled **in-memory inside `AuditRunner.run()`** and consumed within that run — **never persisted**, never carried on outcome/recommendation rows                                                                   | `packages/ad-optimizer/src/revenue-state.ts:33-57`; `audit-runner.ts:443,479-487`; grep: no persisted reader                                                                                                       |
| Confidence curve `min(0.95, 0.5 + 0.15·ln(sourceCount))`; surfacing threshold `{minSourceCount:3, minConfidence:0.66}`; 500-cap                                                                                                                                                             | `packages/schemas/src/deployment-memory.ts:79-88`                                                                                                                                                                  |

## 3. Design decisions

### 3.1 Where the row lands: the creative (Mira) deployment — no org-scoped read, no read migration

The audit's suggested fix was "an org-level shared read tier." I am **not** building that, because
the binding consumer contract already says otherwise. The shipped Mira builder reads `revenue_proven`
**the same way it reads `taste`** — from its _own_ creative deployment (slice-2 spec §3.8;
`builders/mira.ts:242-248`). The canonicalKey is a _creative descriptor_ (`{mode}_{hookType}`), not a
Riley campaign id. So the cleanest seam that lights up the dead read is to **write the `revenue_proven`
row onto the CreativeJob's `deploymentId`** (which _is_ the Mira creative deployment). Mira's existing
read then surfaces it unchanged.

"Riley owns promotion" lives in the **decision**, not the row location: the promotion gate is Riley's
economic-attribution metric (`trueRoas` from internal booked revenue ÷ spend), and the writer is a
dedicated promotion module — never Mira's creative-pipeline code (enforced by a test, §3.6). This
keeps "Mira never self-certifies that a creative worked."

**Consequence:** no org-scoped read tier and **no migration for the read** (the audit's premise that a
migration might be needed there is correct — none is). The only schema change is the idempotency
watermark in §3.4, which is a _different_ need.

### 3.2 The writer: a standalone watermarked promotion sweep (mirrors the taste sweep)

A new cron `creative-revenue-proven-promotion` in `apps/api/src/services/cron/revenue-proven-promotion.ts`,
structurally a sibling of `creative-taste-sweep`:

- **Reads** already-persisted `CreativeJob.pastPerformance` (written by the attribution worker on its
  own daily run) — **no Meta calls, no external I/O**.
- Per-job `try/catch` so one bad job skips, never aborts the run.
- Class-E `onFailure` (`makeOnFailureHandler`, audit-record-always, no event, no alert) — the
  attribution-pair convention.
- **No kill-switch** (same justification as the taste sweep: no external I/O, derived data, every
  write reversible via the memory delete API). Production safety is intact regardless: the gate
  requires `delivery:"measured"` pastPerformance, which only exists once `CREATIVE_ATTRIBUTION_ENABLED`
  is on **and** an operator activates a parked ad — both off today. So this ships _live but inert_
  until the pilot deliberately flips attribution on, exactly like `taste`. **No new env var ⇒ no
  env-allowlist change.**

**Why standalone, not riding `riley-outcome-attribution` (a deliberate divergence from spec §3.7).**
Spec §3.7 said "ride the riley-outcome-attribution cron" so the trust gate could read "the same
RevenueState producers the audit uses." But `RevenueState` is **not persisted** (§2) — that coupling
buys nothing here (see §3.5). Stripped of the trust-gate reason, the promotion is structurally
identical to the taste sweep (read persisted creative data → descriptor → upsert memory). Mirroring
that proven precedent as a standalone cron is lower-risk than perturbing the shipped Riley worker, and
keeps this PR focused. The "Riley-owned writer" invariant is preserved by §3.6, not by cron location.

### 3.3 Promotion gate: the pastPerformance floors

A published job is promoted when its parsed `pastPerformance` is `measured_performance` **and** all
floors pass (each numeric guarded with `Number.isFinite` — the NaN-blind-comparison gotcha; these are
JSON-parsed externals):

| Floor                              | Constant                          | Value                  | Why                                                                                                          |
| ---------------------------------- | --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `delivery === "measured"`          | —                                 | —                      | Meta reported real activity (not a parked/zeroed ad)                                                         |
| `meta.spend >= MIN_SPEND`          | `REVENUE_PROVEN_MIN_SPEND`        | `50` (USD major units) | Enough spend that ROAS is meaningful                                                                         |
| `booked.count >= MIN_BOOKED_COUNT` | `REVENUE_PROVEN_MIN_BOOKED_COUNT` | `2`                    | ≥2 **value-positive internal bookings** (not one fluke; count is value-positive by §3.3 of the slice-2 spec) |
| `trueRoas >= MIN_TRUE_ROAS`        | `REVENUE_PROVEN_MIN_TRUE_ROAS`    | `1.5`                  | A real winner: booked value ≥ 1.5× spend                                                                     |

These floors are **grounded in internal booked truth**: `booked.valueCents`/`count` come from
`ConversionRecord`s (`source.conversions:"conversion_records"`), and `trueRoas`'s numerator is internal
booked dollars — exactly "reusing the real booking-value→Riley attribution that already works." Floors
are named constants, reviewed when the first real cohort exists (spec §3.7).

### 3.4 Idempotency: a per-job watermark (`CreativeJob.revenueProvenPromotedAt`) — the one migration

The sweep runs daily; a persistent winner would otherwise be re-counted every day, inflating
`sourceCount` so Mira renders a false "N sources" from one creative — a fidelity violation. The
descriptor (`mode`+`hookType`) is **fixed** for a published job, so a job maps to one bucket forever
and must contribute **exactly once**. Mirroring `tasteCapturedAt`, a new nullable column
`CreativeJob.revenueProvenPromotedAt DateTime?` is the watermark:

- Candidate query (cross-org read; per-row writes org-scoped): `metaCampaignId != null AND
revenueProvenPromotedAt IS NULL`, ordered `createdAt ASC`, FETCH-capped at 500. The NULL filter makes
  the cap bound **pending** work, not history (promoted jobs drop out) — avoiding the
  take-before-filter starvation trap for promoted rows.
- For each candidate that passes the floors: upsert the bucket, then `setRevenueProvenPromotedAt`.
- A measured job **below** the floors is left un-watermarked so it is re-evaluated next run (its spend
  / bookings may still grow). At pilot scale (a handful of published jobs/org) the residual
  never-qualifying set is far under the cap; documented revisit (a `measured`-only index or per-org
  dispatch) if a single org ever accumulates >500 measured-but-non-qualifying published jobs.

Migration: hand-written `ALTER TABLE "CreativeJob" ADD COLUMN "revenueProvenPromotedAt" TIMESTAMP(3);`
in the same commit as the schema change (Postgres is down locally; generated via `prisma migrate diff`
schema-to-migrations, CI validates drift — the worktree-init-Postgres-down convention). Nullable,
additive, no index, no backfill.

### 3.5 The Riley trust veto: deferred, with rationale (a scoped divergence from spec §3.7)

Spec §3.7 listed "AND `measurementTrusted` true and signal health not red" as a required floor. I am
**deferring the live trust veto** this slice, deliberately:

1. `RevenueState` is **in-memory only** inside the weekly audit (§2). Wiring a live read means either
   re-running the audit's denominator-trust + signal-health producers in this sweep (heavy, needs Meta
   calls — out of scope) or persisting `RevenueState` during the audit (scope creep into Riley's audit).
2. The floors are already **measurement-robust**: `measurementTrusted` specifically guards Meta's
   _conversion-denominator_ trust (`evaluateDenominatorStepChange`), but `trueRoas`'s numerator here is
   **internal booked dollars**, not Meta-attributed conversions — structurally immune to the exact
   failure mode the veto guards.
3. The harm of a borderline promotion is low: a soft brief hint, surfaced only after 3 sources / 0.66
   confidence — not a spend or booking action.
4. **No half-wired gate.** Per `feedback_safety_gate_needs_producer_population`, a gate whose producer
   doesn't exist is worse than no gate. Rather than ship an inert trust-reader interface, I ship the
   floors (whose producer — `computePastPerformance` — is real) and name the trust veto as the explicit
   next increment, to be wired when the audit persists a `{measurementTrusted, signalHealthScore}`
   snapshot per org.

### 3.6 canonicalKey, content, and the Riley-owned-writer enforcement

- **canonicalKey:** `revenue_proven:{mode}_{segment}` where `segment = descriptor.structureId ??
descriptor.hookType` — identical vocabulary to `taste`, without polarity (only wins). Conforms to
  `CANONICAL_KEY_PATTERN` and matches the consumer's `REVENUE_PROVEN_KEY` regex exactly.
- **content is a PURE FUNCTION of the bucket** (e.g. `Revenue-proven: polished creatives with
question-style hooks earned ≥1.5x ROAS`). This is **load-bearing** (`feedback_deployment_memory_dedup_axis`
  - slice-2 spec §3.5): the unique constraint is `(org, deployment, category, CONTENT)` while we dedup
    by canonicalKey, so deterministic content makes the constraint a per-bucket constraint and a
    concurrent duplicate create surfaces as a catchable **P2002** (re-find + increment). This consciously
    **overrides spec §3.7's "content carries provenance"**, which contradicts §3.5's own rule and would
    split `sourceCount` across rows. Per-promotion provenance (jobId, campaignId, spend, trueRoas) is
    emitted to the **structured log** at promotion time, not stored in `content`; durable per-promotion
    evidence rows are a documented future refinement (the consumer needs only the bucket signal).
- **Confidence:** `create` at `computeConfidenceScore(1,false)` (0.5) on first promotion; each
  additional distinct qualifying creative in the bucket increments via
  `incrementConfidence(org, id, computeConfidenceScore(sourceCount+1, false))`. 500-cap admission
  mirrors compounding-service/taste exactly (evict the strictly-weaker candidate, else drop).
- **Writer-location enforcement (spec §3.7):** a source-scanning test (mirroring
  `apps/api/src/__tests__/ingress-boundary.test.ts`) asserts `category: "revenue_proven"` appears as a
  write only in `revenue-proven-promotion.ts` — Mira's creative-pipeline code can never self-certify.

### 3.7 Upsert helper: contained duplication (rule of three)

The bucket upsert (find → increment-or-create-with-eviction → P2002 catch) is ~40 lines mirrored from
`upsertTasteBucket`. I **duplicate** it in the new module (clearly attributed to the precedent) rather
than extract a shared helper, to keep the shipped taste sweep byte-untouched and the PR focused. Two
instances is not yet premature-abstraction territory; a shared `upsertCanonicalBucket` is the right
refactor at the **third** writer, noted as a follow-up.

## 4. Architecture & layering

```
creative-attribution worker ──writes──▶ CreativeJob.pastPerformance   (Mira measurement; existing, kill-switched)
                                              │
revenue-proven-promotion cron ──reads listPublished──┤
  (apps/api, Layer 5; the SOLE revenue_proven writer)│ floors (§3.3) + extractCreativeDescriptor (creative-pipeline, L2)
                                              ▼
            DeploymentMemory.create/increment(category:"revenue_proven", deploymentId = job.deploymentId)
                                              │   (via core's CompoundingDeploymentMemoryStore interface; PrismaDeploymentMemoryStore impl)
                                              ▼
   builders/mira.ts  listHighConfidence(orgId, MIRA deploymentId, 0.66, 3)  ──▶ "Measured winner in {mode} mode: {segment} (N sources)"
                                              ▲  (previously-dead read, now alive)
```

Only `apps/api` (Layer 5) can import creative-pipeline (descriptor) + db (stores) + core (memory store
interface) together, so the orchestration lives there. Promotion logic is a pure function over injected
store interfaces (testable without Prisma).

## 5. Files & changes

**L1 — `packages/schemas`**

- none required (the `revenue_proven` enum value already exists).

**L4 — `packages/db`**

- `prisma/schema.prisma`: add `revenueProvenPromotedAt DateTime?` to `CreativeJob`.
- `prisma/migrations/<ts>_creative_job_revenue_proven_promoted_at/migration.sql`: hand-written ADD COLUMN.
- `PrismaCreativeJobStore`: add `listRevenueProvenCandidates(limit)` (narrow `RevenueProvenCandidate`
  projection) + `setRevenueProvenPromotedAt(orgId, id, at)` (org-scoped `updateMany`, `count===0` →
  `StaleVersionError`). Co-located store test (mocked Prisma, mirroring existing patterns).

**L5 — `apps/api`**

- `src/services/cron/revenue-proven-promotion.ts`: floors + constants, `revenueProvenCanonicalKey`,
  `revenueProvenBucketContent` (pure), `upsertRevenueProvenBucket`, `executeRevenueProvenPromotion(deps)`,
  `createRevenueProvenPromotion(deps)` (Inngest fn, daily `0 7 * * *` — after the `0 6` attribution
  dispatch so same-day measured rows are visible; Class-E `onFailure`; no kill-switch).
- `src/bootstrap/inngest.ts`: construct + register the function (reuse the already-built
  `PrismaCreativeJobStore` and `PrismaDeploymentMemoryStore`).
- Tests:
  - `revenue-proven-promotion.test.ts`: floors (each boundary incl. NaN/`Number.isFinite`,
    `trueRoas:null`, `delivery:"no_delivery"`), descriptor→key/content, create→increment, P2002
    re-find+increment, 500-cap eviction + drop, watermark-once (a second run does **not** re-increment),
    org-scoped writes, per-job `try/catch` isolation. Floor inputs built via the **real**
    `computePastPerformance` producer where practical (test from real producer output).
  - **Producer→consumer proof** (`revenue-proven-loop.test.ts`): a shared in-memory memory store; promote
    **3 distinct qualifying creatives** into one bucket → `sourceCount 3`, `confidence ≈ 0.665`; run the
    real `miraBuilder` with a reader over that store → assert `TASTE_CONTEXT` contains the string
    `builders/mira.ts` renders from the canonicalKey via _its own_ `HOOK_PHRASE`/`describeSegment`
    (NOT the stored content): `Measured winner in polished mode: question hooks (3 sources)`, and the
    key is in `injectedPatternIds`. Proves the previously-dead read now surfaces a Riley write
    **through the real 0.66/3 surfacing threshold**.
  - `revenue-proven-writer-boundary.test.ts`: the §3.6 source-scan (only `revenue-proven-promotion.ts`
    writes the category).

## 6. Out of scope (named, not omitted)

- The live Riley trust veto (§3.5) — wired when the audit persists `RevenueState`.
- F5 (structured Alex booking→outcome row) — the following slice.
- Org-scoped shared-read tier / any Alex read of `revenue_proven` (Alex has no creative-descriptor
  consumer; not part of closing the Riley→Mira edge).
- A shared `upsertCanonicalBucket` refactor (§3.7) — rule of three.
- Per-promotion durable evidence rows (§3.6) — logged for now.

## 7. Invariants held

- Existing spine only: a derived-projection cron by established convention; no new ingress intent, no
  new orchestration engine, no governance change.
- Nothing built-but-unwired: producer (`computePastPerformance`) is real; the writer ships with its live
  consumer (`builders/mira.ts`), proven by the §5 end-to-end test through the real threshold.
- Dedup axis honored: pure-bucket content + P2002 catch + canonicalKey dedup.
- Fidelity: per-job watermark prevents `sourceCount` inflation, so "N sources" is never a lie.
- Tenant safety: every write org-scoped; cross-org candidate _read_ is a system cron, writes per-row scoped.
- Writer location test-pinned (Riley-owned; Mira never self-certifies).

## 8. What flips it live

The same two switches as the slice-2 measured channel: `CREATIVE_ATTRIBUTION_ENABLED=true` (so
`pastPerformance` reaches `delivery:"measured"`) **and** an operator activating a parked Mira ad pointed
at a conversion-attributed destination (so `booked.*`/`trueRoas` are non-empty). Until then the writer
runs and finds nothing to promote — live but inert, by design.
