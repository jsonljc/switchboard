# A6 — Riley contract honesty + cap telemetry — Implementation Plan

> **For agentic workers:** TDD task-by-task. Steps use checkbox (`- [ ]`) syntax. Each task ends with a green test + a commit. Verify `pnpm --filter <pkg> exec tsc --noEmit` before EVERY commit (pre-commit hook = eslint+prettier only, NOT tsc). After a lower-pkg change, rebuild its dist (`pnpm --filter <pkg> build`) so api/chat tsc + the eval see the new types.

**Goal:** Make Riley's blast-radius contract HONEST (mark the unwired guardrails + reset_prior_budget rollback NOT-WIRED; document the pre-write cap as the only active protection), add detective telemetry to the pre-write cap, fix the stale EXECUTOR_NOT_WIRED comment, clarify scale-up = budget-increase-only in operator copy, and record the flag-flip gate. Do NOT build the forward monitor/rollback/kill-switch (deferred per D3).

**Architecture:** Comment/doc/copy + one observability counter. ZERO money-behavior change: `assertWithinBlastRadius` logic is byte-unchanged; a metric is emitted alongside it. The contract stays a Layer-2 type-only module (honesty in doc comments + a typed const, mirroring `SPEC_1B_PENDING_KINDS`). The metric interface lives in core; the prom factories + the emit site live in apps.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turbo), Vitest, prom-client, Zod. Workstream: riley.

## Global Constraints (verbatim where exact)

- No em-dashes anywhere (copy, comments, docs). Lowercase commit subject (Conventional Commits).
- ESM only, `.js` extensions in relative imports. No `any`. Prettier: semi, double quotes, 2-space, trailing commas, 100-char.
- File size: error >600 lines (arch:check counts RAW `.ts` lines, separate from eslint). Split proactively.
- Metric parity is typecheck-enforced: a new `SwitchboardMetrics` field forces all 3 factories (core in-memory + api prom + chat prom) or tsc reds.
- Authority: SURFACE-before-merge (money-adjacent). Do NOT auto-merge.
- D3 LOCKED: down-scope + gate the real wiring to the flag-flip. NO speculative forward monitor.

## Ground-truth anchors (verified vs main @115c15d5f)

- Contract: `packages/ad-optimizer/src/blast-radius-contract.ts` — guardrail/rollback types :33-60, `assertWithinBlastRadius` :115-136, `DEFAULT_BLAST_RADIUS_CONTRACT` :147-155.
- ZERO production consumer of `.guardrails`/`.rollback`/`reset_prior_budget`/the metric strings (grep: only the contract's own test + barrel re-export). The cap IS consumed by the real executor + the pure shadow harness.
- Real executor: `apps/api/src/services/workflows/riley-budget-execution-workflow.ts` — verdict computed :304-308, refusal :309-318, `observedPriorCents:live` :326. Pure DI; no metrics import yet.
- Metric factories: `packages/core/src/telemetry/metrics.ts` (interface :7, in-memory :129), `apps/api/src/metrics.ts` (~:232), `apps/chat/src/bootstrap/metrics.ts` (~:232). A5b recipe = `robinRecoverySendFailed`. Emit idiom `getMetrics().X.inc({labels})` from `@switchboard/core`. bookedValueResolution precedent: labels `["orgId","outcome"]`.
- Stale comment: `apps/api/src/bootstrap/contained-workflows.ts:614-615` (EXECUTOR_NOT_WIRED) — drifted from the plan's :559-560. Executor handler wired at :500.
- Flag gate: `apps/api/src/bootstrap/inngest.ts:584-589` (gates the SUBMITTER behind RILEY_REALLOCATE_SELF_EXECUTION_ENABLED).
- Rank-24 copy: `packages/core/src/agent-home/pipeline-riley.ts:28` (asserted pipeline-riley.test.ts:92) + `packages/ad-optimizer/src/recommendation-engine.ts:353` (no test/eval asserts the title).
- Marker idiom: `packages/core/src/recommendations/outcome-attribution-config.ts:50` `SPEC_1B_PENDING_KINDS` (typed const + activation comment).

---

### Task 1: Define the cap-telemetry metric across all 3 factories

**Files:**

- Modify: `packages/core/src/telemetry/metrics.ts` (interface + createInMemoryMetrics)
- Modify: `apps/api/src/metrics.ts` (createPromMetrics)
- Modify: `apps/chat/src/bootstrap/metrics.ts` (createPromMetrics)
- Test: `packages/core/src/telemetry/__tests__/metrics.test.ts`

**Interfaces:**

- Produces: `SwitchboardMetrics.rileyReallocationCapEvaluated: Counter`, label keys `{ orgId, outcome }`, `outcome ∈ {"within_cap","delta_cap","share_cap"}`. Prom name `switchboard_riley_reallocation_cap_evaluated_total`, labels `["orgId","outcome"]`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/telemetry/__tests__/metrics.test.ts`:

```ts
describe("rileyReallocationCapEvaluated", () => {
  it("createInMemoryMetrics exposes rileyReallocationCapEvaluated and accepts {orgId, outcome}", () => {
    const m = createInMemoryMetrics();
    expect(typeof m.rileyReallocationCapEvaluated.inc).toBe("function");
    expect(() =>
      m.rileyReallocationCapEvaluated.inc({ orgId: "org_1", outcome: "within_cap" }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it, verify RED** — `pnpm --filter @switchboard/core test -- metrics.test.ts`. Expected: FAIL/typecheck error `rileyReallocationCapEvaluated` does not exist on `SwitchboardMetrics`. (RED proof = the property is undefined.)

- [ ] **Step 3: Add the interface field** in `packages/core/src/telemetry/metrics.ts` immediately AFTER the `robinRecoverySendFailed: Counter;` block (currently :73), BEFORE `llmCacheCallsTotal`:

```ts
/** Riley reallocate pre-write blast-radius cap evaluation OUTCOME, emitted once per
 *  `assertWithinBlastRadius` call in the reallocate executor (the ONLY active blast-radius
 *  protection). outcome in {within_cap, delta_cap, share_cap} mirrors the verdict union;
 *  share_cap also covers an unsizable/non-finite account spend (fails closed). Detective
 *  control (A6/D3): makes the cap accept-vs-refuse rate observable. Reachability EQUALS the
 *  reallocate executor's: it fires only when the executor runs, gated behind
 *  RILEY_REALLOCATE_SELF_EXECUTION_ENABLED (default OFF). NOT a separate flag, NOT observable
 *  while the executor is dark. Labeled by orgId + outcome. */
rileyReallocationCapEvaluated: Counter;
```

- [ ] **Step 4: Add the in-memory factory entry** in `createInMemoryMetrics` after `robinRecoverySendFailed: new InMemoryCounter(),` (currently :166):

```ts
    rileyReallocationCapEvaluated: new InMemoryCounter(),
```

- [ ] **Step 5: Add the api PromCounter** in `apps/api/src/metrics.ts` after the `robinRecoverySendFailed: new PromCounter(...)` block (currently :232-236):

```ts
    rileyReallocationCapEvaluated: new PromCounter(
      "switchboard_riley_reallocation_cap_evaluated_total",
      "Riley reallocate pre-write blast-radius cap evaluations by org and outcome (within_cap/delta_cap/share_cap); the cap is the only active blast-radius protection. Fires only when the reallocate executor runs (gated by RILEY_REALLOCATE_SELF_EXECUTION_ENABLED)",
      ["orgId", "outcome"],
    ),
```

- [ ] **Step 6: Add the chat PromCounter** — identical block in `apps/chat/src/bootstrap/metrics.ts` after its `robinRecoverySendFailed` PromCounter (currently :232-236).

- [ ] **Step 7: Rebuild core dist + typecheck the apps** (so api/chat tsc see the new field):

```bash
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/core exec tsc --noEmit
pnpm --filter @switchboard/api exec tsc --noEmit
pnpm --filter @switchboard/chat exec tsc --noEmit
```

Expected: all clean.

- [ ] **Step 8: Run the test, verify GREEN** — `pnpm --filter @switchboard/core test -- metrics.test.ts`. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/telemetry/metrics.ts packages/core/src/telemetry/__tests__/metrics.test.ts apps/api/src/metrics.ts apps/chat/src/bootstrap/metrics.ts
git commit -m "feat(telemetry): add riley reallocation pre-write cap metric across all 3 factories"
```

---

### Task 2: Emit the metric at the pre-write cap in the real executor

**Files:**

- Modify: `apps/api/src/services/workflows/riley-budget-execution-workflow.ts` (import + emit at :304-308)
- Test: `apps/api/src/services/workflows/__tests__/riley-budget-execution-workflow.test.ts`

**Interfaces:**

- Consumes: `getMetrics().rileyReallocationCapEvaluated` (Task 1).

- [ ] **Step 1: Write the failing tests** — append to `riley-budget-execution-workflow.test.ts`. First add the import near the top (after line 5):

```ts
import { setMetrics, createInMemoryMetrics, getMetrics } from "@switchboard/core";
```

Then append a describe block:

```ts
describe("buildRileyBudgetExecutionWorkflow — cap telemetry (A6)", () => {
  it("emits within_cap on an accepted move", async () => {
    setMetrics(createInMemoryMetrics());
    const incSpy = vi.spyOn(getMetrics().rileyReallocationCapEvaluated, "inc");
    const h = harness();
    await h.handler.execute(workUnit(), services);
    expect(incSpy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "within_cap" });
  });
  it("emits delta_cap when the dollar cap is breached", async () => {
    setMetrics(createInMemoryMetrics());
    const incSpy = vi.spyOn(getMetrics().rileyReallocationCapEvaluated, "inc");
    const h = harness();
    await h.handler.execute(workUnit(params({ toCents: 50_000 })), services);
    expect(incSpy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "delta_cap" });
  });
  it("emits share_cap when account spend cannot size the move (null spend)", async () => {
    setMetrics(createInMemoryMetrics());
    const incSpy = vi.spyOn(getMetrics().rileyReallocationCapEvaluated, "inc");
    const h = harness({ getAccountDailySpendCents: vi.fn(async () => null) });
    await h.handler.execute(workUnit(), services);
    expect(incSpy).toHaveBeenCalledWith({ orgId: "org_1", outcome: "share_cap" });
  });
});
```

- [ ] **Step 2: Run, verify RED** — `pnpm --filter @switchboard/api test -- riley-budget-execution-workflow.test.ts`. Expected: FAIL (the spy is never called; the emit does not exist yet). RED proof = `toHaveBeenCalledWith` reports 0 calls.

- [ ] **Step 3: Add the import** in `riley-budget-execution-workflow.ts` after line 1 (`import type { WorkflowHandler, WorkTrace } ...`):

```ts
import { getMetrics } from "@switchboard/core";
```

- [ ] **Step 4: Emit once, right after the verdict** — insert BETWEEN the `assertWithinBlastRadius(...)` call (ends :308) and `if (!verdict.ok) {` (:309):

```ts
getMetrics().rileyReallocationCapEvaluated.inc({
  orgId: organizationId,
  outcome: verdict.ok ? "within_cap" : verdict.reason === "DELTA_CAP" ? "delta_cap" : "share_cap",
});
```

(Emitting before the `if` means both the refuse-return and the accept-continue paths record exactly once.)

- [ ] **Step 5: Typecheck + run, verify GREEN**

```bash
pnpm --filter @switchboard/api exec tsc --noEmit
pnpm --filter @switchboard/api test -- riley-budget-execution-workflow.test.ts
```

Expected: clean + PASS (all 3 new + the existing S2-S5 unaffected).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/workflows/riley-budget-execution-workflow.ts apps/api/src/services/workflows/__tests__/riley-budget-execution-workflow.test.ts
git commit -m "feat(api): emit detective telemetry at riley's reallocation pre-write cap"
```

---

### Task 3: Mark the contract's guardrails + rollback NOT-WIRED (honesty)

**Files:**

- Modify: `packages/ad-optimizer/src/blast-radius-contract.ts` (typed const + field/interface doc markers; NO logic change)
- Test: `packages/ad-optimizer/src/blast-radius-contract.test.ts`

**Interfaces:**

- Produces: `BLAST_RADIUS_PROTECTIONS` (module-exported const; not barrel-exported — only the test + human readers consume it, mirroring `SPEC_1B_PENDING_KINDS`).

- [ ] **Step 1: Write the failing test** — append to `blast-radius-contract.test.ts` (and add `BLAST_RADIUS_PROTECTIONS` to the existing import from `./blast-radius-contract.js`):

```ts
describe("BLAST_RADIUS_PROTECTIONS — honest wiring state (A6/D3)", () => {
  it("marks the pre-write cap WIRED and the forward guardrails + rollback NOT WIRED", () => {
    expect(BLAST_RADIUS_PROTECTIONS.preWriteCap).toBe("wired");
    expect(BLAST_RADIUS_PROTECTIONS.forwardGuardrails).toBe("not_wired");
    expect(BLAST_RADIUS_PROTECTIONS.automatedRollback).toBe("not_wired");
  });
});
```

- [ ] **Step 2: Run, verify RED** — `pnpm --filter @switchboard/ad-optimizer test -- blast-radius-contract.test.ts`. Expected: FAIL/typecheck (`BLAST_RADIUS_PROTECTIONS` not exported).

- [ ] **Step 3: Add the typed const** in `blast-radius-contract.ts`, immediately before the `BlastRadiusGuardrailMetric` type (currently :33):

```ts
/**
 * Honesty marker (A6 / decision D3): the wiring state of this contract's three protections. The
 * ONLY one with a consumer today is the pre-write cap; the forward guardrails and the automated
 * rollback are a FORWARD INTERFACE with ZERO consumer (grep proves no `.guardrails`/`.rollback`/
 * `reset_prior_budget` read outside this module's own test). Recorded intent, not enforcement.
 * Wiring AND exercising end-to-end (at least once) the forward guardrail-evaluation monitor +
 * automated rollback + a genuine kill-switch is a HARD precondition of flipping
 * RILEY_REALLOCATE_SELF_EXECUTION_ENABLED. See docs/runbooks/riley-reallocation-go-live.md.
 * Mirrors the SPEC_1B_PENDING_KINDS idiom (a typed const documenting deferred state). Inaccurate
 * comments are worse than none; an off-flag is not a safety boundary (Knight Capital).
 */
export const BLAST_RADIUS_PROTECTIONS = {
  /** assertWithinBlastRadius: WIRED. The reallocate executor calls it before every Meta write. */
  preWriteCap: "wired",
  /** BlastRadiusContract.guardrails: NOT WIRED. No forward monitor reads them (deferred per D3). */
  forwardGuardrails: "not_wired",
  /** BlastRadiusRollback / reset_prior_budget: NOT WIRED. Nothing runs the rollback (deferred D3). */
  automatedRollback: "not_wired",
} as const;
```

- [ ] **Step 4: Update the field + interface doc comments** (text only) so present-tense claims become NOT-WIRED:
  - `BlastRadiusGuardrail` interface doc (the block at :21-32): prepend a first line: `NOT WIRED (BLAST_RADIUS_PROTECTIONS.forwardGuardrails): a guardrail a FUTURE outcome-attribution monitor would evaluate. Zero consumer today (deferred per D3).` Keep the rest.
  - `BlastRadiusRollback` interface doc (:49-56): prepend: `NOT WIRED (BLAST_RADIUS_PROTECTIONS.automatedRollback): the automated breach response a FUTURE monitor would run. Zero consumer today (deferred per D3).`
  - `BlastRadiusContract.guardrails` field comment (:81): replace `/** Guardrail thresholds the forward outcome-attribution cron evaluates. */` with `/** NOT WIRED: guardrail thresholds a FUTURE outcome-attribution monitor would evaluate; zero consumer today (BLAST_RADIUS_PROTECTIONS.forwardGuardrails). Forward interface, not enforcement. */`
  - `BlastRadiusContract.rollback` field comment (:83): replace `/** Automated breach response for the reallocate class. */` with `/** NOT WIRED: the automated breach response a FUTURE monitor would run; zero consumer today (BLAST_RADIUS_PROTECTIONS.automatedRollback). Forward interface, not enforcement. */`
  - In the `DEFAULT_BLAST_RADIUS_CONTRACT` doc (:138-146) the line already says "inert in the executor". Leave it (already honest) but ensure no em-dash is introduced.
  - DO NOT touch `assertWithinBlastRadius` logic. Verify no em-dashes added.

- [ ] **Step 5: Rebuild dist + typecheck + run, verify GREEN**

```bash
pnpm --filter @switchboard/ad-optimizer build
pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit
pnpm --filter @switchboard/ad-optimizer test -- blast-radius-contract.test.ts
```

Expected: clean + PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ad-optimizer/src/blast-radius-contract.ts packages/ad-optimizer/src/blast-radius-contract.test.ts
git commit -m "docs(ad-optimizer): mark blast-radius guardrails + rollback not-yet-wired (honesty marker)"
```

---

### Task 4: Record the flag-flip gate (inngest comment + go-live brief)

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts:584-589` (strengthen the flag comment) — DOC ONLY
- Create: `docs/runbooks/riley-reallocation-go-live.md` — DOC ONLY

DOC-ONLY task: no unit test (testing comment/doc text is brittle and low value). Verified by three-dot diff inspection in VERIFY + the independent review reads it. The runbook is operational doc tightly coupled to THIS slice (it is in the A6 acceptance), not a docs/superpowers planning doc, so it belongs in this PR.

- [ ] **Step 1: Strengthen the inngest flag comment** — replace the block at `inngest.ts:584-589` (the `// SPEC-1B: RILEY_REALLOCATE_SELF_EXECUTION_ENABLED ...` comment + the `...(process.env[...] ...)` lines stay) so the comment reads:

```ts
// SPEC-1B: RILEY_REALLOCATE_SELF_EXECUTION_ENABLED=true wires the budget
// reallocate initiator; default absent = dark. Env-only gate (no per-deployment
// field in v1; mirrors RILEY_PAUSE_SELF_EXECUTION_ENABLED pattern).
// FLAG-FLIP GATE (A6/D3): flipping this on is a real-money self-execution boundary. The ONLY
// active blast-radius protection is the executor's pre-write cap (assertWithinBlastRadius); the
// contract's guardrails + reset_prior_budget rollback are NOT WIRED (BLAST_RADIUS_PROTECTIONS,
// packages/ad-optimizer). HARD precondition before flipping: wire AND exercise end-to-end the
// forward guardrail monitor + automated rollback + a genuine kill-switch. An off-flag is not a
// safety boundary (Knight Capital). See docs/runbooks/riley-reallocation-go-live.md.
```

(Keep the `...(process.env["RILEY_REALLOCATE_SELF_EXECUTION_ENABLED"] === "true" ? { rileyBudgetSubmitter } : {})` lines unchanged.)

- [ ] **Step 2: Create the go-live brief** `docs/runbooks/riley-reallocation-go-live.md`:

```markdown
# Riley budget-reallocation self-execution — go-live gate

**Type:** Operational gate. Records the HARD precondition for flipping
`RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` (Riley's first autonomous real-money mover) and the
current honest safety state. **Default: OFF (dark).**

## What flipping the flag does

`RILEY_REALLOCATE_SELF_EXECUTION_ENABLED=true` wires the reallocate SUBMITTER
(`apps/api/src/bootstrap/inngest.ts`), letting Riley emit `adoptimizer.campaign.reallocate` into
PlatformIngress. Every move still parks on the seeded `require_approval(mandatory)` policy and is
on the D9-2 financial auto-approve denylist, so a human approves each one. The executor
(`riley-budget-execution-workflow.ts`) then runs the read-modify-re-read sequence.

## Scope: BUDGET-INCREASE-ONLY (v1)

v1 only scales budgets UP (`REALLOCATE_SCALE_FACTOR = 1.2`, a +20% increase). Decreases
(`review_budget`) are deferred. Operator-facing copy says "increase budget", not the ambiguous
"scale budget". Approval cards and the agent-home tile reflect this.

## Current safety state (honest, as of this runbook)

- **Active:** the executor's pre-write cap `assertWithinBlastRadius` (the ONLY wired blast-radius
  protection): per-move dollar ceiling (`maxDeltaCents`, $50 default) + account-spend share ceiling
  (`maxAccountSpendShare`, 0.25), fail-closed on a non-finite delta or an unsizable account spend.
- **NOT wired (forward interface, zero consumer):** the contract `guardrails`
  (`account_booked_conversions_drop_share`, `freed_budget_absorbed_share`) and the
  `reset_prior_budget` rollback (`BLAST_RADIUS_PROTECTIONS` in
  `packages/ad-optimizer/src/blast-radius-contract.ts`). No code reads them today.
- **Observability:** `switchboard_riley_reallocation_cap_evaluated_total{orgId,outcome}` (outcome
  = within_cap | delta_cap | share_cap) fires once per cap evaluation IN the executor, so it is
  observable the moment the executor runs (it shares the flag-gated executor's reachability; it is
  NOT observable while the flag is off). For pre-flip preview, run the shadow harness
  (`buildShadowReallocationReport`), which reports the `blastRadiusRejected` count without moving
  money.

## HARD precondition before flipping the flag (do NOT flip until ALL are true)

1. The forward guardrail-evaluation monitor is WIRED (it reads `BlastRadiusContract.guardrails`
   over a real window and trips on a breach).
2. Automated rollback is WIRED (it executes `reset_prior_budget` from the persisted
   `observedPriorCents` on a tripped guardrail).
3. A genuine kill-switch exists (a runtime stop that halts in-flight + future self-execution, not
   merely the env flag).
4. All three have been EXERCISED end-to-end at least once (a real or staged breach tripped the
   monitor, the rollback restored the prior budget, the kill-switch halted execution). An
   unexercised rollback is assumed broken; an off-flag is not a safety boundary (Knight Capital).
5. A Tier-0 credentialed pilot org is provisioned (the executor needs live meta-ads creds).

Until 1-5 hold, `RILEY_REALLOCATE_SELF_EXECUTION_ENABLED` stays OFF. Wiring 1-4 is explicitly
out of scope for the contract-honesty slice (deferred per decision D3; NIST AI RMF staged
autonomy).
```

- [ ] **Step 3: Verify (no test; doc-only)** — `pnpm format:check` over the touched files; eyeball the rendered runbook; confirm NO em-dashes:

```bash
pnpm exec prettier --check docs/runbooks/riley-reallocation-go-live.md apps/api/src/bootstrap/inngest.ts
grep -n "—" docs/runbooks/riley-reallocation-go-live.md apps/api/src/bootstrap/inngest.ts || echo "no em-dashes"
pnpm --filter @switchboard/api exec tsc --noEmit
```

Expected: prettier clean, "no em-dashes", tsc clean (comment-only change).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts docs/runbooks/riley-reallocation-go-live.md
git commit -m "docs(api): record the riley reallocation flag-flip safety gate"
```

---

### Task 5: Fix the stale EXECUTOR_NOT_WIRED comment

**Files:**

- Modify: `apps/api/src/bootstrap/contained-workflows.ts:614-615` — DOC ONLY

DOC-ONLY: the comment claims the executor is "a fail-closed placeholder (EXECUTOR_NOT_WIRED)". The real read-modify-re-read executor IS wired (`rileyBudgetExecutor.handler` in the handler map at :500), proven by the full `riley-budget-execution-workflow.test.ts` suite. This step makes the comment match that tested reality. Verified by diff + the existing executor tests.

- [ ] **Step 1: First re-confirm no OTHER stale reference** (grep, to avoid missing a twin):

```bash
grep -rn "EXECUTOR_NOT_WIRED\|fail-closed placeholder" apps/api/src --include="*.ts" | grep -v "\.test\.ts"
```

Expected: only `contained-workflows.ts:614`. If a twin appears, fix it too in this task.

- [ ] **Step 2: Replace the stale comment** at `contained-workflows.ts:614-615` (the two `// ... EXECUTOR_NOT_WIRED ... PR 1B-1.5 ...` lines). New text:

```ts
// policyApprovalOverride). The executor is the REAL read-modify-re-read reallocate executor
// (buildRileyBudgetExecutorHandler -> buildRileyBudgetExecutionWorkflow), wired into the
// handler map above (rileyBudgetExecutor.handler). The reallocate path stays dark in prod
// because the SUBMITTER that emits this intent is gated behind
// RILEY_REALLOCATE_SELF_EXECUTION_ENABLED (bootstrap/inngest.ts); the flag-flip safety gate
// is docs/runbooks/riley-reallocation-go-live.md. Internal-trigger-only.
```

- [ ] **Step 3: Verify (doc-only)**

```bash
pnpm exec prettier --check apps/api/src/bootstrap/contained-workflows.ts
pnpm --filter @switchboard/api exec tsc --noEmit
grep -n "—" apps/api/src/bootstrap/contained-workflows.ts || echo "no em-dashes"
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts
git commit -m "docs(api): correct the stale executor-not-wired comment for the reallocate intent"
```

---

### Task 6: Clarify scale-up = budget-increase-only in operator copy (rank 24)

**Files:**

- Modify: `packages/core/src/agent-home/pipeline-riley.ts:28` (tile verb) + Test `packages/core/src/agent-home/__tests__/pipeline-riley.test.ts:86,92`
- Modify: `packages/ad-optimizer/src/recommendation-engine.ts:353` (rec card title; drop em-dash) + Test `packages/ad-optimizer/src/recommendation-engine.test.ts`
- Modify: `packages/ad-optimizer/src/budget-reallocation-plan.ts:46` (strengthen comment to "budget-increase-only")

**Interfaces:**

- The recommendation TYPE/kind `"scale"` / intent `recommendation.scale_budget` is UNCHANGED (structural id). Only operator-facing COPY changes.

- [ ] **Step 1: Update the pipeline test (RED)** in `pipeline-riley.test.ts`: change the title at :86 to `it("uses known-intent map for scale_budget -> 'increase budget'", ...)` and the assertion at :92 to:

```ts
expect(vm.tiles[0]!.ctx).toBe("$1,200 at risk · increase budget");
```

- [ ] **Step 2: Run, verify RED** — `pnpm --filter @switchboard/core test -- pipeline-riley.test.ts`. Expected: FAIL (`received "... · scale budget"`).

- [ ] **Step 3: Change the pipeline verb** in `pipeline-riley.ts:28`:

```ts
  "recommendation.scale_budget": "increase budget",
```

- [ ] **Step 4: Run, verify GREEN** — `pnpm --filter @switchboard/core test -- pipeline-riley.test.ts`. Expected: PASS.

- [ ] **Step 5: Add the rec-title test (RED)** — first locate an existing scale-rec test in `recommendation-engine.test.ts` (search `"scale"`); add (or extend the scale case with) an assertion that the title is increase-explicit and em-dash-free. Minimal new test (adapt the existing scale-rec setup helpers in that file; do NOT invent inputs — reuse the file's fixture builder):

```ts
  it("scale rec title says 'increase budget' (budget-increase-only, no em-dash)", () => {
    // reuse the file's existing scale-producing inputs (cpa>0, cpa<0.8*target, no breach, no diagnoses)
    const recs = <call the file's existing generate helper for the scale scenario>;
    const scale = recs.find((r) => r.type === "scale");
    expect(scale).toBeDefined();
    expect(scale!.title).toContain("increase budget");
    expect(scale!.title).not.toContain("—");
  });
```

NOTE for executor: if the file already has a scale-rec test asserting the title, extend THAT test instead of adding a new one (DRY). If producing a scale rec in isolation is non-trivial, assert via the existing scale test's `recs`.

- [ ] **Step 6: Run, verify RED** — `pnpm --filter @switchboard/ad-optimizer test -- recommendation-engine.test.ts`. Expected: FAIL (title still `"... — scale budget by up to 20%"`).

- [ ] **Step 7: Change the rec title** in `recommendation-engine.ts:353` (drop the em-dash, say increase):

```ts
        `Campaign is performing well under target CPA; increase budget by up to ${MAX_BUDGET_INCREASE_PERCENT}%`,
```

(Leave the two proposedActions at :355-356 as-is; they are already increase-explicit.)

- [ ] **Step 8: Strengthen the plan comment** in `budget-reallocation-plan.ts:46`: change `v1 only scales UP; decreases (review_budget) are deferred.` to `v1 is budget-increase-only (scales UP); decreases (review_budget) are deferred.`

- [ ] **Step 9: Rebuild dist + typecheck + run, verify GREEN**

```bash
pnpm --filter @switchboard/ad-optimizer build
pnpm --filter @switchboard/core build
pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit
pnpm --filter @switchboard/core exec tsc --noEmit
pnpm --filter @switchboard/ad-optimizer test -- recommendation-engine.test.ts
pnpm --filter @switchboard/core test -- pipeline-riley.test.ts
```

Expected: clean + PASS.

- [ ] **Step 10: Run eval:riley (engine touched)** — `pnpm eval:riley`. Expected: GREEN (the eval does not assert the rec title; this is a regression check). If it reds on the title, investigate before proceeding.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/agent-home/pipeline-riley.ts packages/core/src/agent-home/__tests__/pipeline-riley.test.ts packages/ad-optimizer/src/recommendation-engine.ts packages/ad-optimizer/src/recommendation-engine.test.ts packages/ad-optimizer/src/budget-reallocation-plan.ts
git commit -m "fix(ad-optimizer): clarify scale-up reallocation as budget-increase-only in operator copy"
```

---

## VERIFY (after all tasks)

Dispatch a verifier subagent to RUN (return per-gate pass/fail + only the failing excerpt):

- `pnpm typecheck`; `pnpm test`; `pnpm --filter @switchboard/api test`; `pnpm --filter @switchboard/core test`; `pnpm --filter @switchboard/ad-optimizer test`
- `pnpm lint`; `pnpm format:check`; `pnpm arch:check`
- `CI=1 npx tsx scripts/local-verify-fast.ts` (route/env allowlist gate)
- `pnpm build` (apps touched)
- `pnpm eval:riley` (engine touched in Task 6)
- `pnpm audit --audit-level=high` (security gate)
- NO `pnpm db:check-drift` (no schema change).
- Three-dot diff proof `git diff origin/main...HEAD`; confirm each acceptance item.
- `pnpm exec tsx .agent/tools/check-routes.ts --mode=error` is N/A (no prisma mutation added) but run it to be safe (the `architecture` CI job runs it).

## Independent review (not self-gradable)

Dispatch a FRESH-context reviewer with ONLY the three-dot diff + acceptance + the relevant feedback\_\*.md (safety_gate_needs_producer_population, no_em_dashes, arch_check_ts_only). Must confirm: telemetry has a LIVE tested emit site (not inert); the metric is in all 3 factories; NO speculative forward-monitor wiring; the not-wired markers match the ACTUAL grep'd consumer state (zero consumer); the cap logic is byte-unchanged.

## REVISION 1 (post fan-out grade, 2026-06-22) — SUPERSEDES Task 6 + 2 nits

Three opus reviewers (CRITIC/COMPLETENESS/CODE-GROUNDED) graded the plan. Design core PASSED unanimously: live tested emit site (real executor path, real handler via DI), metric in all 3 factories with satisfiable parity, zero-consumer claim independently grep-confirmed 3x, `assertWithinBlastRadius` logic byte-unchanged, no speculative forward-monitor wiring, runbook-on-impl-branch is the correct branch-doctrine call, no new env/route allowlist needed. REVISE was triggered (>=2 agreeing) only on Task 6 test mechanics. Fixes below are AUTHORITATIVE; follow them over the original Task 6.

**R1-a (blocker, 3x): test file path.** The rec-engine test is `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts` (NOT `src/recommendation-engine.test.ts`). Use the `__tests__/` path in the run commands AND the `git add`.

**R1-b (blocker, 3x): field names.** `RecommendationOutput` has `action` (the rec kind) and `estimatedImpact` (the headline copy string = the 5th `makeRec` arg at recommendation-engine.ts:87); there is NO `title`, and `type` is the constant literal `"recommendation"`. The string at recommendation-engine.ts:353 is `estimatedImpact`. Do NOT use `.type === "scale"` or `.title`.

**R1-c (warn, 2x): docstring drift.** `budget-reallocation-plan.ts:44` also quotes the engine's old `"scale budget by up to 20%"`; it must track the Step-7 change.

**Revised Task 6 steps (replace Steps 5-9 + 11):**

- Step 5 (RED): extend the EXISTING test `"scale steps mention 20% budget cap"` (`__tests__/recommendation-engine.test.ts:97-116`, which already does `const scale = recs(result).find((r) => r.action === "scale")`). Append:

```ts
expect(scale!.estimatedImpact).toContain("increase budget");
expect(scale!.estimatedImpact).not.toContain("—");
```

- Step 6 (RED proof): `pnpm --filter @switchboard/ad-optimizer test -- recommendation-engine.test.ts` -> FAIL (estimatedImpact still `"...— scale budget by up to 20%"`: both new assertions fail).
- Step 7: change the scale rec `estimatedImpact` (5th `makeRec` arg) at recommendation-engine.ts:353 to:

```ts
        `Campaign is performing well under target CPA; increase budget by up to ${MAX_BUDGET_INCREASE_PERCENT}%`,
```

(Leave the two `steps` at :355-356 unchanged: "20% higher budget" / "Budget increase capped at 20%".)

- Step 8: in `budget-reallocation-plan.ts` update BOTH: :44 `engine's advertised "scale budget by up to 20%"` -> `engine's advertised "increase budget by up to 20%"`; and :46 `v1 only scales UP; decreases (review_budget) are deferred.` -> `v1 is budget-increase-only (scales UP); decreases (review_budget) are deferred.`
- Step 9 (GREEN): rebuild ad-optimizer + core dist, typecheck both, run the two tests by basename (path correct: `__tests__/recommendation-engine.test.ts`).
- Step 11 (commit) `git add`: use `packages/ad-optimizer/src/__tests__/recommendation-engine.test.ts` (with `__tests__/`).

**R1-d (nit): Task 3 Step 4 first bullet** — the :21-32 block documents the `BlastRadiusGuardrailMetric` TYPE (the metric union), not the `BlastRadiusGuardrail` interface (:37, which has no own doc). Prepend the NOT-WIRED marker there anyway (it is the first thing a reader hits); just know it is the metric-type doc.

**R1-e (nit): Task 2 import placement** — add `import { setMetrics, createInMemoryMetrics, getMetrics } from "@switchboard/core";` to the top-level import block of the test (next to the other `@switchboard/*` imports); and `import { getMetrics } from "@switchboard/core";` to the workflow file's import block (it coexists with the existing type-only `@switchboard/core/platform` import). Exact line offsets are not load-bearing.

## Acceptance map

- Honest contract (guardrails + rollback marked NOT-WIRED; cap = only active protection): Task 3.
- Cap emits telemetry (new metric, live emit site, all 3 factories): Tasks 1-2.
- Stale EXECUTOR_NOT_WIRED comment fixed (rank 31): Task 5.
- Scale-up clarified = budget-increase-only in approval cards + go-live brief (rank 24): Tasks 4, 6.
- Flag-flip gate recorded (forward monitor + rollback + kill-switch wired AND exercised before the flag): Tasks 3, 4.
- eval:riley green: Task 6 / VERIFY. Forward monitor NOT built: confirmed by the diff (no new consumer of guardrails/rollback).
