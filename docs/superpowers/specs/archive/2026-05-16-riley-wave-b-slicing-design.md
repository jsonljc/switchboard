# Riley Cockpit — Wave B Slicing Design

**Date:** 2026-05-16
**Status:** Spec — ready for Wave B PR-1 implementation plan via writing-plans
**Parent spec:** [Riley Agent-Infra Parity — Wave B Doctrine Spec](./2026-05-14-riley-agent-infra-parity-design.md) (acceptance-criteria only; this spec adds slicing)
**Sibling slicing template:** [Riley Cockpit — Wave A Slicing Design](./2026-05-14-riley-cockpit-wave-a-slicing-design.md)
**Alex parallel (substrate Wave B reuses):** [Alex Agent-Infra Parity](./2026-05-13-agent-infra-parity-design.md) — PR-3 / 3.1.b / 3.2a-d shipped; PR-3.2e in review

---

## Summary

Converts the seven Wave B acceptance criteria into a sequenced PR plan. Wave B closes Riley's operational-doctrine gap **underneath** the Wave A cockpit — by the adapter-boundary contract Wave A locked in, every Wave B slice is a layer-3-or-below change with zero cockpit UI impact.

This spec **commits firmly to PR-1 (WorkTrace mirror)** as the next concrete Riley workstream. PRs-2 through 6 are sketched here as the sequence-of-record; **slices 2-6 are re-brainstormed after PR-1 ships and we have 2-4 weeks of accumulating Riley WorkTrace volume to verify the substrate-swap contract empirically**. The parent spec explicitly allows partial scope; this spec exercises that latitude.

---

## Decision: partial-scope, phased-mirror approach

The parent spec asks an open question:

> Does Wave B ship as one large workstream or as a phased sequence mirroring Alex's PR-3 / 3.1 / 3.2 split (correctness → attribution → learning quality)?

**Locked answer: phased, with hard commitment only to PR-1.** Alex's slicing pattern (correctness-first substrate → attribution → learning quality) maps cleanly to Riley's seven criteria; we adopt it. But the parent spec's preconditions 3 and 4 (reliable `meta-campaign-insights-provider` daily data + real Riley recommendation volume) gate the _value_ of slices 3-5. PR-1 has no such gate — it's pure substrate, valuable even if Riley never accumulates volume.

### Three approaches considered

|                          | A — All seven, one workstream    | **B — Phased, commit only to PR-1 (locked)**                              | C — Skip Wave B entirely, defer until volume |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| PRs                      | 1 monstrous, or 6-7 rapid-fire   | **1 now (PR-1) + 5 sketched in this spec, re-brainstormed post-PR-1**     | 0                                            |
| First user-visible value | After PR-3 (outcome attribution) | **PR-3 (later)**; PR-1 ships invisibly                                    | Never                                        |
| Reversibility            | High risk if outcomes don't land | **High — PR-1 is pure addition; subsequent slices conditional on signal** | n/a                                          |
| Adapter-boundary risk    | Diffuse across 6 PRs in flight   | Concentrated in PR-1's review                                             | n/a                                          |
| Matches preconditions    | Violates preconditions 3+4       | **Respects them**                                                         | Sidesteps them                               |

**Why B wins:** PR-1's value is _intrinsic_ (canonical decision observability, future-proof read path, parity with Alex's substrate write side). PR-2 onward's value is _conditional_ on Riley emission volume + Meta-insights reliability. Committing to PR-2+ now would be predicting those conditions; committing to PR-1 now establishes the foundation either way.

---

## The seven criteria — sequenced

The seven Wave B acceptance criteria fall into a strict dependency DAG. The sequence below honors it.

```
            ┌──────────────────────┐
            │ PR-1: WorkTrace      │ ← foundation; every other slice reads
            │ mirror               │   from this
            └──────────┬───────────┘
                       │
            ┌──────────▼───────────┐
            │ PR-2: PlatformIngress│ ← integration spine; pairs criteria
            │ route + Executable-  │   2+3 (one without the other is awkward)
            │ WorkUnit (paired)    │
            └──────────┬───────────┘
                       │
            ┌──────────▼───────────┐
            │ PR-3: Outcome        │ ← needs ExecutableWorkUnit;
            │ attribution          │   flips causal-language gate
            └──────────┬───────────┘
                       │
            ┌──────────▼───────────┐
            │ PR-4: Learning       │ ← needs outcome rows;
            │ memory               │   reuses Alex's OUTCOME_PATTERNS substrate
            └──────────────────────┘

  ┌──────────────────────┐
  │ PR-5: Governance     │ ← independent of PR-1..4; can ship any time;
  │ hook unification     │   scheduled here to limit concurrent review surface
  └──────────────────────┘

  ┌──────────────────────┐
  │ PR-6: Unified        │ ← deepest migration; last; benefits least from urgency
  │ approval lifecycle   │
  └──────────────────────┘
```

### Dependency notes

- **PR-2 pairs criteria 2 (PlatformIngress) and 3 (ExecutableWorkUnit)** deliberately. The parent spec lists them as separate criteria, but PlatformIngress's natural output IS an ExecutableWorkUnit row — splitting them creates an awkward intermediate slice that accepts ingress submissions but doesn't materialize anything actionable downstream. Alex's PR-3 absorbed both at once for the same reason.
- **PR-3 (outcome attribution) is what flips the causal-language gate.** Wave A B.2's "Honest impact-language guardrail" relaxes only after PR-3 ships. PR-3's diff includes the cockpit-side copy change.
- **PR-5 (governance hook unification) is sequence-independent.** It's a signature-only refactor of `learning-phase-guard` to implement `SkillHook`. It can ship before PR-1 if review bandwidth wants it earlier; we sequence it here only to keep concurrent Wave B reviews bounded.
- **PR-6 (unified approval lifecycle) is the deepest substrate migration.** It needs to land last because (a) it touches the most surface area, (b) its primary value (cross-agent approval queries) only materializes once PR-1's WorkTrace data has accumulated.

---

## Slice B-Wave-1 — WorkTrace mirror

**Single question this slice answers:** _Does every Riley recommendation emission write a canonical `WorkTrace` row alongside the existing `Recommendation` row, transactionally, without changing any cockpit UI or operator behavior?_

### What ships

- **Dual-write in `emitRecommendation`.** `packages/core/src/recommendations/emit.ts` accepts an optional `WorkTraceStore` and an Org/agent-scoped clock. When present, `emitRecommendation` opens a single Prisma transaction that:
  1. Inserts the `Recommendation` row via `RecommendationStore.insert(...)` (existing call).
  2. Persists a `WorkTrace` row via the new `WorkTraceStore.persistInTx(...)` method (already exposed for caller-owned transactions; see `prisma-work-trace-store.ts` §line ~95).
- **New `ingressPath` enum value: `"agent_recommendation_emission"`.** Existing values are `"platform_ingress"` and `"store_recorded_operator_mutation"`. Riley emissions are neither — they're agent-side scheduled emissions that don't pass through PlatformIngress (advisory, not actionable until operator approval). Adding a third value is honest; reusing `"store_recorded_operator_mutation"` would lie.
  - **No hash-input version bump required.** `WORK_TRACE_HASH_VERSION_V2` already includes `ingressPath` in the canonical hash input (see `packages/core/src/platform/work-trace-hash.ts`); adding a new enum value is purely additive to the value space, not the input shape. v1 and v2 traces continue to verify; new Riley emissions persist as v2.
- **WorkTrace field mapping** (Riley emissions are advisory, not yet routed through governance):
  | WorkTrace field | Source |
  |---|---|
  | `workUnitId` | new UUID per emission |
  | `intent` | `recommendation.<action>` (e.g., `recommendation.pause_adset`) |
  | `mode` | `"pipeline"` (existing `ExecutionModeName` value — Riley is the ad-optimizer pipeline; no new mode value needed) |
  | `agentKey` | `"riley"` (carried via actor) |
  | `actor` | `{ type: "service", id: "ad-optimizer" }` |
  | `trigger` | `"schedule"` (existing `Trigger` value — Riley emissions are cron-scheduled; the specific cron id lives in `parameters.cronId`) |
  | `parameters` | `{ recommendationId, action, humanSummary, confidence, dollarsAtRisk, cronId, parameters: rec.parameters }` |
  | `governanceOutcome` | `"require_approval"` for `queue` surface; `"execute"` for `shadow_action` |
  | `riskScore` | derived from `riskLevel` (high=0.8, medium=0.5, low=0.2 — same map already used in cockpit) |
  | `matchedPolicies` | `[]` (no Riley-side policies yet; populated when PR-5 lands) |
  | `outcome` | `"pending_approval"` for `queue` surface; `"completed"` for `shadow_action` surface — both existing `WorkOutcome` values |
  | `durationMs` | wall time from emit start to insert commit |
  | `idempotencyKey` | reuse the existing `Recommendation.idempotencyKey` (same SHA-256 hash) so dual-write idempotency aligns naturally |
  | `requestedAt` | now |
  | `governanceCompletedAt` | now (no governance to wait for at emission) |
  | `completedAt` | now (advisory emissions are terminal at emit time — operator approval is a separate WorkTrace chain in PR-2) |
  | `ingressPath` | `"agent_recommendation_emission"` |
  | `hashInputVersion` | `WORK_TRACE_HASH_VERSION_LATEST` (v2 today) |
  | `parentWorkUnitId` | absent (Riley emissions have no parent) |
  | `organizationId` | `rec.orgId` |
  | `deploymentId` | from `rec.parameters.deploymentId` if present; optional |
- **No new `ExecutionModeName` or `WorkOutcome` values.** Existing values already model Riley emissions cleanly: `mode = "pipeline"` (ad-optimizer is a pipeline by architectural category), `outcome = "pending_approval"` for queue-surface emissions awaiting operator approval, `outcome = "completed"` for shadow-action-surface emissions that auto-apply. Reusing existing enum values shrinks the migration surface to a single column.
- **Schema files touched:**
  - `packages/core/src/platform/work-trace.ts` — extend `ingressPath` union to include `"agent_recommendation_emission"`
  - `packages/schemas/src/work-trace.ts` (or wherever the Zod ingress-path enum lives) — extend the Zod enum
  - `packages/db/prisma/schema.prisma` — extend the Postgres enum values for `ingressPath` only; migration via `migrate diff --from-empty --to-schema-datamodel --script` (memory: don't use `migrate dev` in agent sessions)
  - `packages/core/src/platform/work-trace-hash.ts` — **no changes needed**; v2 hash input already includes `ingressPath`. Adding an enum value is value-space-only.
  - `packages/core/src/platform/types.ts` — **no changes needed**; existing `ExecutionModeName` (`"pipeline"`) and `WorkOutcome` (`"pending_approval"` / `"completed"`) values are reused.
- **`emitRecommendation` signature change.** Adds an optional second parameter:
  ```ts
  export async function emitRecommendation(
    store: RecommendationStore,
    input: RecommendationInput,
    options?: { workTraceStore?: WorkTraceStore; now?: () => Date },
  ): Promise<EmitResult>;
  ```
  Optional so existing callers (test fixtures, future non-mirroring contexts) keep compiling. Production callers in `packages/ad-optimizer/src/recommendation-sink.ts` thread the `workTraceStore` through.
- **`RecommendationStore.insert` accepts an optional `tx`.** If `workTraceStore` is provided, `emitRecommendation` opens a `prisma.$transaction(async tx => {...})`, passes the `tx` to both inserts, and commits or rolls back together. The Prisma implementation of `RecommendationStore` already accepts a Prisma tx in adjacent methods (see `prisma-recommendation-store.ts`); extending `insert` is mechanical.
- **Bootstrap wiring.** `packages/ad-optimizer/src/recommendation-sink.ts` (or the `audit-runner` that ultimately calls into the sink) is constructed with a `WorkTraceStore`. In `apps/api`, this is the existing `PrismaWorkTraceStore` singleton already used elsewhere. In tests, an in-memory mock.

### What does NOT ship in PR-1

- ❌ Any change to the cockpit UI, cockpit hooks, or cockpit adapters. PR-1 is invisible to operators.
- ❌ Any change to `actOnRecommendation` (operator-approval path) — PR-1 is emission-side only. PR-2 handles the operator-approval mirror.
- ❌ Any read consumer of the new `WorkTrace` rows. The Wave A adapter still reads from `Recommendation`; `WorkTrace` is a shadow column for PR-1.
- ❌ Outcome attribution, learning memory, governance hook unification, unified approval lifecycle (PRs 3-6).
- ❌ Backfill of historical `Recommendation` rows into `WorkTrace`. PR-1 is prospective-only. If a Wave C migration eventually swaps the substrate, that's where backfill belongs.
- ❌ Any new `ingressPath` semantics beyond `"agent_recommendation_emission"`. PR-2 may add `"agent_executor_attempt"` or similar; out of PR-1 scope.
- ❌ Causal-language gate flip — that's PR-3.

### PR-1 acceptance criteria

1. Every emission through `emitRecommendation` (any agent, any surface ≠ `"dropped"`) writes both a `Recommendation` row and a `WorkTrace` row when a `WorkTraceStore` is configured. The two writes commit or roll back together via a single Prisma transaction.
2. Idempotency: when `emitRecommendation` is called twice with the same `RecommendationInput` (same intent + targets + day-bucket), both calls produce a single `Recommendation` row AND a single `WorkTrace` row. The shared `idempotencyKey` enforces this on both tables.
3. `WorkTrace.ingressPath = "agent_recommendation_emission"` on every Riley emission row.
4. `WorkTrace.mode = "pipeline"` on every Riley emission row. `WorkTrace.outcome = "pending_approval"` for queue-surface emissions; `WorkTrace.outcome = "completed"` for shadow-action-surface emissions. (Both existing enum values; no schema migration for these.)
5. `WorkTrace.idempotencyKey` matches the corresponding `Recommendation.idempotencyKey`.
6. `WorkTrace.intent = "recommendation.<action>"` mapping covers all 11 Riley action variants (per [Wave A slicing §Adapter responsibilities](./2026-05-14-riley-cockpit-wave-a-slicing-design.md#adapter-responsibilities-b1)).
7. The grep query `SELECT count(*) FROM "WorkTrace" WHERE "ingressPath" = 'agent_recommendation_emission' AND "agentKey" = 'riley'` returns the same count as `SELECT count(*) FROM "Recommendation" WHERE "agentKey" = 'riley' AND "createdAt" > <PR-1 deploy timestamp>` for any time window after PR-1 deploys. This is the substrate-symmetry invariant.
8. `WorkTrace.contentHash` is populated; integrity verification passes (`verifyWorkTraceIntegrity` returns `"verified"` for every new row).
9. Pre-existing v1 and v2 traces still verify; new Riley v2 traces with the new ingressPath value verify.
10. Wave A cockpit UI, cockpit hooks, and cockpit adapter file count are unchanged. `git diff main -- apps/dashboard/src/lib/cockpit/riley/ apps/dashboard/src/components/cockpit/` returns zero changes.
11. The grep smoke check from Wave A's adapter contract returns the same result on the PR-1 branch as on `main` (no new cockpit-side imports of `WorkTrace`, no leak across the boundary).
12. Existing `emitRecommendation` callers without a `WorkTraceStore` configured continue to work — write only a `Recommendation` row, no error.
13. Failure mode: if `WorkTraceStore.persistInTx` throws, the entire transaction rolls back; no orphaned `Recommendation` row. Verified by integration test.
14. Reverse failure mode: if `RecommendationStore.insert` throws, no orphaned `WorkTrace` row. Verified by integration test.
15. `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm --filter @switchboard/dashboard build` (per `feedback_dashboard_build_not_in_ci`) all clean.
16. Tests cover: dual-write happy path, idempotent re-emission, two-way rollback, all 11 action variants, shadow-action (`outcome = "completed"`) vs queue (`outcome = "pending_approval"`) surfaces, `mode = "pipeline"`, v2 integrity verification with the new ingressPath value, the missing-WorkTraceStore back-compat path.

### Dependencies

- **None on Wave A.** Wave A B.1-B.3 already shipped (2026-05-15).
- **None on Alex Wave B work.** Alex's PR-3/3.1.b/3.2 is the conceptual parallel but doesn't share write code with Riley emissions. Alex's WorkTrace is written by `SkillExecutor` after governance evaluation; Riley's WorkTrace is written at emit time by `emitRecommendation`. Independent code paths.
- **Substrate already exists.** `PrismaWorkTraceStore.persistInTx` is the only existing seam needed. The Prisma `WorkTrace` table already supports all required fields modulo the three enum extensions (mode, outcome, ingressPath).

### Risks specific to PR-1

1. **Enum extensions are a migration.** Postgres enums require a one-way `ALTER TYPE ... ADD VALUE` migration. **Mitigation:** generate via `prisma migrate diff --from-empty --to-schema-datamodel --script` (memory: `feedback_prisma_migrate_dev_tty`); review the SQL by hand; deploy with `migrate deploy`. The three enum extensions are independent and additive — no values renamed, no values removed.
2. **v2 hash input must keep verifying with the new ingressPath value.** Existing rows must continue to verify, and new Riley emissions must hash correctly as v2. **Mitigation:** because v2 hash input already includes `ingressPath` as a free-form string within the hashed payload, no version branching is needed. Test pin: a v1 fixture row + a v2 fixture row (existing values) + a fresh v2 row with `ingressPath = "agent_recommendation_emission"` all return `"verified"` from `verifyWorkTraceIntegrity`.
3. **Transaction holds two writes + audit-ledger insert.** Latency budget: the existing `RecommendationStore.insert` finishes in <100ms; `WorkTraceStore.persistInTx` is +1 insert + audit-ledger insert (which `persistInTx` deliberately swallows failures of, to avoid escalating audit issues into emission rollbacks — see `prisma-work-trace-store.ts` §line 96-104). Total transaction wall time still <300ms p99. **Mitigation:** measure in test; alert if p99 regresses.
4. **`recommendation-sink` callers need wiring updates.** Production caller in `apps/api` is the only mandatory path. **Mitigation:** explicit grep `rg "emitRecommendation\(" apps/ packages/` to enumerate; wire each.
5. **Idempotency-key collision unlikely but possible.** Two Riley emissions sharing the SHA-256 truncated to 32 hex chars is astronomically unlikely but the same key is now used to dedupe in two tables. **Mitigation:** treat the `idempotencyKey` as the primary identity surface for the dual write; verify both tables consider a re-emission idempotent rather than a hard error.
6. **Test-fixture sprawl.** The existing `emitRecommendation` test suite passes a `RecommendationStore` mock; PR-1 adds an optional `WorkTraceStore` mock. **Mitigation:** keep the change opt-in by making the second param optional; existing tests don't change unless they specifically test dual-write.

### Verification before merge

- `pnpm typecheck` clean.
- `pnpm lint` clean.
- `pnpm test` clean (note: `feedback_db_integrity_tests_pg_advisory_lock` is a pre-existing flake in `prisma-work-trace-store-integrity` / `prisma-ledger-storage` / `prisma-greeting-signal-store` — reproduces on baseline, OK to ignore if it fires on the PR branch only when it fires on `main` too).
- `pnpm --filter @switchboard/dashboard build` clean (per `feedback_dashboard_build_not_in_ci`).
- `pnpm db:check-drift` clean (per CLAUDE.md schema-change requirement).
- Wave A cockpit visual smoke check: `/riley` renders identically on the PR branch vs. main (no UI regression).

---

## Slice B-Wave-2 — PlatformIngress route + ExecutableWorkUnit materialization (sketch)

**Re-brainstormed after PR-1 ships.** Sketched here as the sequence-of-record; do NOT implement from this section directly.

### What ships (anticipated)

- Operator-approved Riley recommendations route their executor call (`meta-ad.pause`, `meta-ad.scale`, `meta-creative.refresh`, etc.) through `PlatformIngress.submit()`.
- The ingress envelope carries the operator's actor identity, the originating `Recommendation.id`, and a parent-link to the WorkTrace from PR-1.
- Approval triggers materialize an `ExecutableWorkUnit` row + `ExecutionAttempt` records; the existing 1-hour Undo on `pause` becomes a property of the `ExecutableWorkUnit` lifecycle (not the `Recommendation` row).
- A new `ingressPath = "platform_ingress"` WorkTrace row is created for each executor attempt, linked back to the PR-1 emission WorkTrace via `parentWorkUnitId`.

### Why it's deferred

- Riley's executor path today is `actOnRecommendation` → direct Meta API call. Rewriting that to route through `PlatformIngress` is a meaningful refactor of the operator-approval flow. PR-1 ships value (canonical decision observability) without touching this path.
- The value of `ExecutableWorkUnit` materialization is gated by criterion 4 (outcome attribution). Without outcome attribution, ExecutableWorkUnit rows accumulate but contribute nothing the existing `Recommendation.acted` event-stream doesn't.
- Re-brainstorming after PR-1 lets us observe what PR-1's WorkTrace data actually looks like in production before designing the operator-approval mirror.

### Re-brainstorm trigger

When PR-1 has been live for ≥2 weeks AND Riley has emitted ≥100 advisory recommendations across ≥3 organizations AND the `meta-campaign-insights-provider` daily data is observed-reliable.

---

## Slice B-Wave-3 — Outcome attribution (sketch)

**Re-brainstormed after PR-2 ships.**

### What ships (anticipated)

- A new Inngest cron (`executeDailyRileyOutcomeAttribution`, modeled on Alex's `executeDailyPatternDecay`) runs daily, finds `ExecutableWorkUnit` rows whose action-appropriate observation window has just closed, queries `meta-campaign-insights-provider` for post-execution metrics, and writes one `Outcome` row per executed action.
- Observation windows (from parent spec §4): 7-day for `pause` (spend-saved); 7-day for `scale` (spend + leads delta vs counterfactual); 14-day for `refresh_creative` (CTR + frequency recovery); 14-day for `shift_budget_to_source` (source-level ROAS delta).
- Outcome records carry `executableWorkUnitId`, `windowStartedAt`, `windowEndedAt`, the metric snapshot, and (where available) a CAPI-confirmed conversion count alongside Meta-reported aggregates.
- **The causal-language gate flips here.** Wave A B.2's "Honest impact-language guardrail" relaxes for actions with shipped outcomes: cockpit copy can claim "saved $X over 7-day window (CAPI-attributed)" or "Reported ROAS +0.4 over 14-day window" backed by outcome rows. Estimated `dollarsAtRisk` remains for pre-decision UI.

### Why it's deferred

- Outcome attribution requires real executions (PR-2) AND reliable Meta-insights data AND reasonable Riley emission volume. All three preconditions are uncertain until PR-1 has been live for weeks.
- The cockpit-side language change is the most operator-visible win, but it's only honest after the substrate is real.

---

## Slice B-Wave-4 — Learning memory (sketch)

**Re-brainstormed after PR-3 ships.**

### What ships (anticipated)

- Riley reads from + writes to the same `OUTCOME_PATTERNS` pgvector substrate Alex uses (built by `project_agent_infra_pr3_merged` work; see `packages/core/src/memory/`).
- Riley pattern accumulation goes through `ConversationCompoundingService` (or a Riley-side parallel `RecommendationCompoundingService`) when an outcome row lands.
- Riley's recommendation engine reads `OUTCOME_PATTERNS` context per the same `ContextBuilder.build()` path Alex's conversation handler uses; confidence-weighting of future recommendations becomes a function of past outcomes.
- Pattern decay reuses Alex's `executeDailyPatternDecay` cron (PR-3.2d); no second decay path.

### Why it's deferred

- Pattern detection needs sample size. Parent spec precondition 4 says "dozens of executed actions of each type across multiple orgs." Without that, learning memory adds infrastructure for nothing.

---

## Slice B-Wave-5 — Governance hook unification (sketch, sequence-independent)

**Could ship anywhere. Sequenced after PR-4 to limit concurrent Wave B review surface.**

### What ships (anticipated)

- `learning-phase-guard` in `packages/ad-optimizer/src/` is refactored to implement the `SkillHook` interface (same shape as Alex's `deterministic-safety-gate`).
- The hook chain runs at pre-emission for advisory recs (PR-1's path) and pre-execution for approved actions (PR-2's path).
- Hook composition becomes possible: future per-org guards (e.g., "max paused-spend per week," "block all recommendations during freeze windows") plug into the same chain.
- Existing `LearningPhaseGuardV2` behavior is preserved — refactor is signature-only.

### Why it's deferred

- Pure refactor; ships value only when composition is exercised. Compose-able hooks are most valuable when there are 2+ hooks to compose. Today there's one (`learning-phase-guard`).

---

## Slice B-Wave-6 — Unified approval lifecycle (sketch)

**Re-brainstormed after PR-5 ships. Deepest substrate migration; last.**

### What ships (anticipated)

- `Recommendation.status` becomes a denormalized projection of `ApprovalLifecycle.status`. One write target: when an operator approves or declines, the write goes to `ApprovalLifecycle`; the `Recommendation.status` field updates as a denormalization.
- Queries like "everything Riley did this week with outcomes," "operator approval SLA across all agents," "approval volume by urgency band" become single-table joins.
- The Wave A adapter still reads `Recommendation.status` — substrate-swap-transparent.

### Why it's deferred

- Touches the most code surface. Benefits least from urgency (the cross-agent query value requires both Alex's already-on-ApprovalLifecycle data AND Riley's to-be-migrated data; the migration is the bottleneck).
- Migration of historical `Recommendation` rows is non-trivial. Open question from the parent spec — backfill vs prospective-only cutover.

---

## Adapter-boundary verification per slice

Wave A's adapter boundary (cockpit UI consumes view-models only; only adapter files may know about `Recommendation` + `AuditEntry`) makes Wave B a layer-3-or-below workstream. Each slice respects the boundary by construction:

| Slice                                             | Layer touched                             | Cockpit UI / hooks / adapters                      | UI risk                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PR-1 (WorkTrace mirror)                           | Core + db + schemas + ad-optimizer wiring | **Zero**                                           | ✅ None — WorkTrace is shadow; nothing reads it                                                                                    |
| PR-2 (PlatformIngress route + ExecutableWorkUnit) | Core + db + ad-optimizer executor wiring  | **Zero**                                           | ✅ `actOnRecommendation`'s return shape unchanged; cockpit observes the same approval-handshake behavior                           |
| PR-3 (Outcome attribution)                        | Core + db + schemas + new Inngest cron    | **Copy-only**, B.2 honest-impact guardrail relaxes | ⚠ Smell — if copy change requires structural UI change, the adapter boundary leaked                                                |
| PR-4 (Learning memory)                            | Core + recommendation engine              | **Zero**                                           | ✅ Pattern reads happen inside the engine; cockpit observes confidence-weighted recs but doesn't render pattern metadata at Wave B |
| PR-5 (Governance hook unification)                | Core (skill-runtime) + ad-optimizer       | **Zero**                                           | ✅ Signature refactor, no UI                                                                                                       |
| PR-6 (Unified approval lifecycle)                 | Core + db + schemas                       | **Zero**                                           | ✅ Substrate-swap-transparent; cockpit still reads `Recommendation.status`                                                         |

**The cleanest signal that Wave B is doing its job:** the cockpit renders identically before and after each slice. If any slice forces a UI change, the adapter boundary leaked — fix the leak before shipping the slice.

---

## Backwards-compat strategy

| Phase                     | `Recommendation` table                                                                 | `WorkTrace` table                                              |
| ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Today (pre-Wave B)        | Primary read source; primary write target                                              | Empty for Riley                                                |
| Post-PR-1                 | Primary read source; primary write target                                              | **Shadow** — populated by dual-write; no reader                |
| Post-PR-2                 | Primary read source; primary write target                                              | Shadow + executor traces with `parentWorkUnitId` link          |
| Post-PR-3                 | Primary read source; primary write target                                              | Shadow + executor traces + outcome rows                        |
| Post-PR-6                 | Primary read source; `status` is denormalized projection of `ApprovalLifecycle.status` | Canonical decision history                                     |
| **Wave C** (out of scope) | Eventually consistent view-cache; deprecated                                           | Canonical read source; cockpit adapters swap to read from here |

**Migration of `Recommendation` rows to canonical `WorkTrace`-only storage is a Wave C decision**, deferred until Wave B has been live long enough to verify the substrate-swap contract empirically. Parent spec open question 4 (backfill vs prospective-only) is a Wave C question.

---

## Reversibility / observation window scheduling

Outcome observation windows are action-specific (parent spec §4):

| Action                   | Observation window | Metric                                |
| ------------------------ | ------------------ | ------------------------------------- |
| `pause`                  | 7 days             | Spend saved                           |
| `scale`                  | 7 days             | Spend + leads delta vs counterfactual |
| `refresh_creative`       | 14 days            | CTR + frequency recovery              |
| `shift_budget_to_source` | 14 days            | Source-level ROAS delta               |

**Implementation pattern (PR-3 anticipated):** an Inngest cron (`executeDailyRileyOutcomeAttribution`) runs daily, queries `ExecutableWorkUnit` rows where `executedAt + windowDays = today` (per-action window mapping), fetches `meta-campaign-insights-provider` data for `[executedAt, executedAt + windowDays]`, writes one `Outcome` row per closed window. Same shape as Alex's `executeDailyPatternDecay` (PR-3.2d).

Outcome rows are indexed by `(executableWorkUnitId, windowEndedAt)` for per-recommendation queries and by `(agentKey, windowEndedAt)` for cross-action aggregates.

---

## Causal-language gating

The Wave A B.2 "Honest impact-language guardrail" enforces:

> No copy in B.2 claims Riley improved metrics. Allowed: estimated `dollarsAtRisk` (pre-decision), reported metrics from Meta or CRM, connection health. Causal attribution to Riley's actions is reserved for Wave B outcome attribution.

**The gate flips at PR-3** (outcome attribution). PR-3's diff includes the cockpit-side copy change — but only for actions that have a corresponding `Outcome` row. Actions without an outcome (in-flight observation window, attribution failed) continue rendering the pre-PR-3 honest copy. Causal language is per-row, not per-cockpit.

Implementation note: the per-row gate is a cockpit adapter concern (layer 3), not a UI concern. The view-model exposes an `attributedImpact?: { window, metric, value, source }` optional field — when present, cockpit renders causal copy; when absent, falls back to estimated copy. PR-3's only UI-side change is a single conditional in the row template; the rest is adapter-side.

---

## Open questions for the PR-1 implementation plan

These are slicing-time questions resolved here:

- ✅ **Dual-write vs cockpit substrate swap at PR-1?** Dual-write. Cockpit adapters still read `Recommendation`. WorkTrace is shadow until Wave C.
- ✅ **`ingressPath` enum extension or repurpose existing value?** Extend with `"agent_recommendation_emission"`. Repurposing `"store_recorded_operator_mutation"` would be semantically dishonest.
- ✅ **New `mode` / `outcome` enum values?** No — existing `mode = "pipeline"` (ad-optimizer pipeline) and `outcome = "pending_approval"` / `"completed"` (per surface) model Riley emissions cleanly. Reusing existing values shrinks the migration to one enum column (`ingressPath`).
- ✅ **Hash-input version bump?** Yes — `hashInputVersion = 3` for traces with the new ingressPath. v1/v2 verification preserved.
- ✅ **Transactional dual-write?** Yes — single Prisma transaction, both inserts commit or roll back together.

These are deferred to the PR-1 writing-plans step:

- [ ] **Should `RecommendationStore.insert`'s tx parameter be added or is it already supported?** Confirm against `prisma-recommendation-store.ts` source at plan time. If absent, the plan adds it.
- [ ] **`recommendation-sink.ts` constructor wiring.** Verify the bootstrap site in `apps/api` and the test-fixture sites to enumerate the change surface.
- [ ] **WorkTrace test mocks.** `prisma-work-trace-store-integrity` tests are flaky (`feedback_db_integrity_tests_pg_advisory_lock`). PR-1 tests should mirror the existing Riley-store mock pattern (no real Postgres in vitest), not the integrity-test pattern.
- [ ] **`deploymentId` resolution from `Recommendation`.** Riley recs carry `parameters.deploymentId` in some emit paths but not all (`recommendation-sink.ts` constructs them from `audit-runner` output). Resolve at plan time: either require `deploymentId` on Riley emissions (small schema tightening) or store WorkTrace without `deploymentId` and look up by `orgId` later.

---

## What this spec does NOT do

- **Implement.** PR-1 lands via a separate implementation-plan PR + implementation PR per the cockpit doctrine (slicing-design docs land first; implementation PRs consume them — the same shape Wave A used for B.1, B.2a, B.2b, B.3).
- **Commit to PRs 2-6.** Those slices are sketched as the anticipated sequence; they are NOT implementation targets until re-brainstormed after PR-1 ships.
- **Touch cockpit UI.** By construction — every slice is a layer-3-or-below change.
- **Bind the order of PR-5.** PR-5 (governance hook unification) is sequence-independent and could ship earlier or later. The sketch order is a default, not a constraint.

---

## Scope decision summary

**Hard commitment:** PR-1 (WorkTrace mirror) ships now.

**Re-brainstorm trigger for PR-2:** PR-1 is live for ≥2 weeks AND Riley has emitted ≥100 advisory recommendations across ≥3 organizations AND `meta-campaign-insights-provider` daily data is observed-reliable.

**Rationale:** The parent spec's preconditions 3 and 4 gate the value of PRs 2-6; they don't gate PR-1. PR-1's value is intrinsic (canonical decision observability). PR-2 onward's value is conditional. Committing only to PR-1 honors the parent spec's explicit allowance for partial scope while preserving the option to ship the full sequence.

This is **Approach B (phased)** from the §Decision table — locked.
