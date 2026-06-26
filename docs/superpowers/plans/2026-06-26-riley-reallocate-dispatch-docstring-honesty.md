# Riley reallocate-dispatch docstring honesty (P3-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `buildRileyBudgetCandidate` docstring tell the truth about the reallocate self-submission contract, and pin that contract with co-located tests so code and docs cannot silently re-diverge.

**Architecture:** Pure documentation-correctness change in `packages/ad-optimizer`, backed by characterization tests. No behavior change, no exported-signature change, no cross-layer impact. The reallocate (Spec-1B act-leg) candidate path is correct as written; only its docstring is stale.

**Tech Stack:** TypeScript (ESM), vitest, pnpm + Turborepo. Layer-2 package `@switchboard/ad-optimizer` (depends on `@switchboard/schemas` only).

## Global Constraints

- ESM only; `.js` suffixes on relative imports.
- No `any`; no `console.log` (use `console.warn`/`console.error`).
- Prettier: semicolons, double quotes, 2-space indent, trailing commas, 100-char width.
- Conventional Commits, lowercase subject.
- **No em-dashes anywhere in the diff** (prose, comments, strings). Scan `git diff` before each commit.
- Every new module has a co-located `*.test.ts`.
- Gates per commit: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit` + `pnpm --filter @switchboard/ad-optimizer test` + `pnpm eval:riley` green. This change is NOT cross-layer (no exported signature change), so no consumer-package typecheck is required, but `pnpm --filter @switchboard/core exec tsc --noEmit` is a cheap belt-and-suspenders check.

---

## Background: the gap (P3-1)

From `docs/audits/2026-06-22-second-wave-gap-eval/README.md` row P3-1:

> Reallocate-dispatch docstring falsely claims arbitration + evidence floor "are applied at the sink wiring"; the sink applies neither (pause path applies both). Self-execution flag off.

The false text is in `packages/ad-optimizer/src/riley-budget-dispatch.ts:44-46`:

> "Arbitration ("which reallocation is the primary") and the evidence floor are applied at the sink wiring (PR 1B-1.3), not here."

This is false on three counts:

1. **Arbitration is NOT applied to reallocate.** The sink wiring (`recommendation-sink.ts:543-558` -> `budget-sink-dispatch.ts` -> `buildRileyBudgetCandidate`) passes no `index`/`primaryIndex`. The arbitrator's own invariant states the opposite: "the only primary-gated consumer (pause self-submission)" (`opportunity-arbitrator.ts:240-241`). The pause path gates on `index === primaryPauseIndex`; the budget path has no such concept.
2. **No evidence floor is applied at the sink wiring.** `buildRileyBudgetCandidate` copies `context.evidence` verbatim and never checks a floor. The base scale-family evidence floor (`{clicks:30, conversions:3, days:7}`) is enforced UPSTREAM at engine emission (`recommendation-engine.ts:433-448`, Gate 2: a sub-floor scale rec is demoted to an abstention `WatchOutput` and never reaches this builder as `action:"scale"`). The pause path additionally applies a RAISED execution floor (`meetsRileyPauseExecutionFloor`, 100/10) at dispatch; reallocate has no such raised floor by design.
3. **Wrong PR citation.** PR 1B-1.3 was "structured spend delta into the gate" (`docs/superpowers/plans/2026-06-14-spec1b-act-leg-implementation.md`), not an arbitration/floor change.

## Decision (the design fork, resolved)

The fork: **(A)** make the docstring tell the truth, or **(B)** make the sink actually apply arbitration + a raised evidence floor (mirroring pause). Self-execution flag is OFF, so the consequence is latent.

**Decision: Option A - correct the docstring; the code is correct by the reallocate design.** Three authoritative sources converge that reallocate is _intentionally_ not primary-gated and has no raised candidate-side floor:

- **Arbitrator invariant** (`opportunity-arbitrator.ts:240-241`): pause self-submission is "the only primary-gated consumer." Treating reallocate as not-primary-gated is the documented status quo, and the value-ranking safety argument is built on it.
- **Reallocate flip-readiness spec** (`docs/superpowers/specs/2026-06-25-riley-reallocate-act-leg-flip-readiness-design.md`), the authority on the act-leg go-live: the reallocate safety envelope is entirely _executor-side_ (blast-radius cap + always-on guardrail monitor + automated rollback + per-deployment kill-switch) plus `require_approval(mandatory)`. It never specifies primary-only or a raised candidate floor. The pause path's "single mutating primary" is a destructive-action discipline, not the reallocate model.
- **Engine Gate 2** (`recommendation-engine.ts:433-448`): the base scale floor already gates emission, so the floor IS applied - just upstream, not "at the sink wiring."

Why **not** Option B: forcing pause-style symmetry would (a) collapse reallocate to a single primary per audit run, defeating "push budget toward multiple proven winners" (the value-capture north-star encoded in the arbitrator), and (b) add an unmandated raised floor to a money path with no spec basis, risking the producer-population inert trap. Both are behavior changes to a money path with zero spec mandate - wrong per "no premature abstractions" and "anchor on the spec."

**Scope note for the reviewer:** the budget builder also omits `isPhaseCActionClassEligible`, which the pause builder calls. That is deliberate and out of scope: class-eligibility is a Phase-C-pause-track predicate (`action-contract.ts:183-201`); reallocate is the separate Spec-1B act-leg track. This plan touches ONLY the two claims the audit flags (arbitration + evidence floor).

Because the fix is documentation, "TDD" here means **characterization/guard tests**: tests that pin the contract the corrected docstring asserts. They pass against today's code (no behavior change) and will FAIL if a future change adds a primary-gate or a candidate-side floor, forcing the docstring back into sync.

## File Structure

- **Create** `packages/ad-optimizer/src/riley-budget-dispatch.test.ts` - co-located test for the `riley-budget-dispatch.ts` module (currently it has none; the builder is only tested indirectly via `budget-sink-dispatch.test.ts`). Pins the reallocate candidate contract.
- **Modify** `packages/ad-optimizer/src/riley-budget-dispatch.ts:39-46` - rewrite the `buildRileyBudgetCandidate` docstring to the true contract. No code change.

---

### Task 1: Pin the reallocate candidate contract (guard tests)

**Files:**

- Create: `packages/ad-optimizer/src/riley-budget-dispatch.test.ts`

**Interfaces:**

- Consumes: `buildRileyBudgetCandidate(args)` from `./riley-budget-dispatch.js` - returns `RileyBudgetCandidate | null`. `Evidence = {clicks; conversions; days}` and `HandoffCampaignContext = {evidence; learningPhaseActive}` from `./evidence-floor.js` / `./recommendation-handoff-dispatch.js`.
- Produces: nothing consumed downstream (test-only).

- [ ] **Step 1: Write the guard tests**

```ts
import { describe, it, expect } from "vitest";
import { buildRileyBudgetCandidate } from "./riley-budget-dispatch.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";

function ctx(over?: Partial<HandoffCampaignContext>): HandoffCampaignContext {
  return {
    evidence: { clicks: 100, conversions: 12, days: 7 },
    learningPhaseActive: false,
    ...over,
  };
}

function args(over?: Partial<Parameters<typeof buildRileyBudgetCandidate>[0]>) {
  return {
    emitted: {
      recommendationId: "rec_1",
      actionType: "scale" as const,
      campaignId: "camp_1",
      rationale: "scale the winner",
      surface: "queue" as const,
    },
    currentDailyBudgetCents: 5000,
    proposedDailyBudgetCents: 6000,
    context: ctx(),
    organizationId: "org_1",
    deploymentId: "dep_riley",
    adAccountId: "act_1",
    ...over,
  };
}

describe("buildRileyBudgetCandidate (reallocate candidate contract)", () => {
  it("builds a candidate for a well-formed scale rec, carrying the context evidence verbatim", () => {
    const c = buildRileyBudgetCandidate(args());
    expect(c).not.toBeNull();
    expect(c?.campaignId).toBe("camp_1");
    expect(c?.adAccountId).toBe("act_1");
    expect(c?.evidence).toEqual({ clicks: 100, conversions: 12, days: 7 });
  });

  // CONTRACT: no candidate-side evidence floor. The base scale floor (30/3/7) is enforced
  // UPSTREAM at engine emission (recommendation-engine.ts Gate 2: sub-floor scale recs are
  // demoted to a WatchOutput and never reach this builder as action:"scale"). So the builder
  // itself must NOT re-floor: it builds even on below-base-floor evidence. If a future change
  // adds a floor here, this test breaks and the docstring must be re-checked.
  it("applies NO evidence floor here: builds even on below-base-floor evidence", () => {
    const c = buildRileyBudgetCandidate(
      args({ context: ctx({ evidence: { clicks: 1, conversions: 0, days: 1 } }) }),
    );
    expect(c).not.toBeNull();
    expect(c?.evidence).toEqual({ clicks: 1, conversions: 0, days: 1 });
  });

  // CONTRACT: not arbitration-primary-gated. The builder takes no index/primaryIndex input;
  // two independent scale recs each build a candidate (no primary-only collapse). The pause
  // path is "the only primary-gated consumer" (opportunity-arbitrator.ts).
  it("is not primary-gated: independent scale recs each build a candidate", () => {
    const a = buildRileyBudgetCandidate(
      args({
        emitted: {
          recommendationId: "rec_a",
          actionType: "scale",
          campaignId: "camp_a",
          rationale: "a",
          surface: "queue",
        },
      }),
    );
    const b = buildRileyBudgetCandidate(
      args({
        emitted: {
          recommendationId: "rec_b",
          actionType: "scale",
          campaignId: "camp_b",
          rationale: "b",
          surface: "queue",
        },
      }),
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  // The builder's ONLY abstentions are well-formedness (never "not the arbitration primary").
  it("abstains only on well-formedness (non-scale / dropped / no context / no ids / null budget / zero delta)", () => {
    expect(
      buildRileyBudgetCandidate(
        args({
          emitted: {
            recommendationId: "r",
            actionType: "pause",
            campaignId: "c",
            rationale: "x",
            surface: "queue",
          },
        }),
      ),
    ).toBeNull();
    expect(
      buildRileyBudgetCandidate(
        args({
          emitted: {
            recommendationId: "r",
            actionType: "scale",
            campaignId: "c",
            rationale: "x",
            surface: "dropped",
          },
        }),
      ),
    ).toBeNull();
    expect(buildRileyBudgetCandidate(args({ context: undefined }))).toBeNull();
    expect(buildRileyBudgetCandidate(args({ deploymentId: "" }))).toBeNull();
    expect(buildRileyBudgetCandidate(args({ adAccountId: "" }))).toBeNull();
    expect(buildRileyBudgetCandidate(args({ currentDailyBudgetCents: null }))).toBeNull();
    expect(
      buildRileyBudgetCandidate(
        args({ currentDailyBudgetCents: 5000, proposedDailyBudgetCents: 5000 }),
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass (characterization - they pin existing behavior)**

Run: `pnpm --filter @switchboard/ad-optimizer test -- riley-budget-dispatch`
Expected: PASS (4 tests). If the "below-floor builds" or "not primary-gated" test FAILS, the code does not match the intended reallocate contract - STOP and reassess the fork rather than editing the docstring.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/ad-optimizer/src/riley-budget-dispatch.test.ts
git commit -m "test(ad-optimizer): pin reallocate candidate contract (no primary-gate, no candidate-side floor) (P3-1)"
```

---

### Task 2: Correct the docstring to the true contract

**Files:**

- Modify: `packages/ad-optimizer/src/riley-budget-dispatch.ts:39-46` (the `buildRileyBudgetCandidate` docstring)

**Interfaces:**

- Consumes: nothing new.
- Produces: no signature change.

- [ ] **Step 1: Replace the false claim**

Replace the existing docstring (lines 39-47, ending `...not here.`) so the final sentences read (truthfully):

```ts
/**
 * Decide whether ONE emitted recommendation becomes a reallocation candidate. Pure + deterministic.
 * The trigger is the `scale` recommendation (Riley's "scale the daily budget up ~20%" semantics); the
 * proposed budget is current x REALLOCATE_SCALE_FACTOR, sized by the sink. Abstains (returns null) for
 * any action other than `scale`, a dropped router surface, missing per-campaign context or ids, an
 * unknown (null) current/proposed budget, or a zero-magnitude no-op. Those well-formedness checks are
 * the builder's ONLY gates. The seeded require_approval(mandatory) policy is the real human gate.
 *
 * Unlike the pause path, reallocate is NOT arbitration-primary-gated: the arbitrator's only
 * primary-gated consumer is pause self-submission (opportunity-arbitrator.ts), so multiple `scale`
 * reallocations may each surface for approval (the value-capture move pushes budget toward several
 * proven winners). And no evidence floor is applied HERE: the base scale-family floor is enforced
 * upstream at engine emission (recommendation-engine.ts Gate 2, which demotes a sub-floor scale rec
 * to an abstention watch before it can reach this builder), and there is no raised execution floor
 * for reallocate (the pause path's meetsRileyPauseExecutionFloor has no reallocate analogue). The
 * reallocate safety envelope is the mandatory human gate plus the executor-side blast-radius cap,
 * guardrail monitor, automated rollback and kill-switch, not candidate-side gating.
 */
```

- [ ] **Step 2: Verify no behavior change (tests + typecheck still green)**

Run: `pnpm --filter @switchboard/ad-optimizer test -- riley-budget-dispatch budget-sink-dispatch`
Expected: PASS (all). Then `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit` -> exit 0.

- [ ] **Step 3: Scan the diff for em-dashes and stray edits**

Run: `git diff` and confirm no `--` em-dashes and only the docstring changed in `riley-budget-dispatch.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/ad-optimizer/src/riley-budget-dispatch.ts
git commit -m "docs(ad-optimizer): correct reallocate-dispatch docstring to the real contract (P3-1)"
```

---

## Final verification (before PR)

- [ ] `pnpm --filter @switchboard/ad-optimizer exec tsc --noEmit` -> exit 0
- [ ] `pnpm --filter @switchboard/ad-optimizer test` -> all green
- [ ] `pnpm --filter @switchboard/core exec tsc --noEmit` -> exit 0 (belt-and-suspenders; not cross-layer)
- [ ] `pnpm eval:riley` -> green (the "Eval - Claim Classifier" CI job is a known ANTHROPIC_API_KEY flake; judge its conclusion, don't be blocked by it)
- [ ] `git diff origin/main...HEAD` reviewed; no em-dashes; only the two files touched

## Self-Review

- **Spec coverage:** P3-1's two false claims (arbitration, evidence floor) + the wrong PR citation are all corrected in Task 2 and pinned in Task 1. Covered.
- **Placeholder scan:** none.
- **Type consistency:** test uses the real `buildRileyBudgetCandidate` arg/return types via `Parameters<typeof ...>`; `Evidence` fields `{clicks, conversions, days}` match `evidence-floor.ts`; `HandoffCampaignContext` shape matches `budget-sink-dispatch.test.ts`.
