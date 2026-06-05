# Riley v3 Slice 5: Phase-C Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the designed-but-unwired Phase-C bridge: the ActionContract execution extension for `pause` and the pause `CanonicalSubmitRequest` mapper with a convention-parity test against the live handoff builder.

**Architecture:** Two halves. The surface-agnostic half (execution contract + class-eligibility predicate) extends `packages/ad-optimizer/src/action-contract.ts` as a SIBLING record, leaving the live `ACTION_CONTRACT` untouched. The platform-typed half (the mapper) lives in `apps/api/src/services/workflows/`, next to the live handoff builder, because `CanonicalSubmitRequest` is a core type and ad-optimizer (Layer 2) cannot import core. Nothing calls the mapper; the parity test ties it to the live builder so convention drift breaks the build. Names are deliberately defensive (`UNWIRED_RILEY_PAUSE_INTENT`, `isPhaseCActionClassEligible`): this is a class contract plus a mapper convention test, not the beginning of a live self-execution path.

**Tech Stack:** TypeScript ESM (`.js` relative imports), vitest, pnpm workspaces.

**Design doc:** `docs/superpowers/specs/2026-06-05-riley-v3-slice5-phase-c-seam-design.md`

**Invariant (grep every commit):** no new `PlatformIngress` reference in `packages/ad-optimizer`, no importer of the mapper outside its test, no duplicate of the intent string outside the mapper and its test, zero behavior change to any live path.

---

### Task 1: Phase-C execution seam in ad-optimizer

**Files:**

- Modify: `packages/ad-optimizer/src/action-contract.ts` (append after `isMutating`)
- Modify: `packages/ad-optimizer/src/action-contract.test.ts` (append a describe block)
- Modify: `packages/ad-optimizer/src/index.ts` (extend lines 140-141 export block)

- [ ] **Step 1: Write the failing tests**

Append to `packages/ad-optimizer/src/action-contract.test.ts` (imports merge into the existing line-2 import from `./action-contract.js`; `evidenceFamilyFor` is already imported from `./evidence-floor.js`):

```ts
import {
  ACTION_CONTRACT,
  isMutating,
  isPhaseCActionClassEligible,
  PHASE_C_EXECUTION_SEAM,
  type ActionContract,
} from "./action-contract.js";
```

```ts
describe("PHASE_C_EXECUTION_SEAM (designed-but-unwired; Riley v3 slice 5)", () => {
  it("contains exactly the pause entry (each class earns its entry when it earns execution)", () => {
    expect(Object.keys(PHASE_C_EXECUTION_SEAM)).toEqual(["pause"]);
  });

  it("pause is platform-state reversible with a resume rollback and non-empty execution metadata", () => {
    const pause = PHASE_C_EXECUTION_SEAM.pause!;
    expect(pause.reversibility).toBe("full");
    expect(pause.rollbackPlan).toMatch(/resume/i);
    expect(pause.rollbackPlan).toMatch(/not .*lost delivery|platform state/i);
    expect(pause.successMetric.length).toBeGreaterThan(0);
    expect(pause.guardrailMetrics.length).toBeGreaterThan(0);
  });

  it("the seam is a SIBLING of the live contract, not a mutation of it", () => {
    // live record untouched: still exactly the 14 actions, and the seam entry is a
    // different object with a different shape from the live pause row
    expect(Object.keys(ACTION_CONTRACT).sort()).toEqual([...ALL_ACTIONS].sort());
    expect(PHASE_C_EXECUTION_SEAM.pause).not.toBe(ACTION_CONTRACT.pause);
    expect(ACTION_CONTRACT.pause).not.toHaveProperty("reversibility");
  });

  it("pause keeps its destructive evidence family (the mapper's floor cannot silently weaken)", () => {
    expect(evidenceFamilyFor("pause")).toBe("destructive");
  });

  it("isPhaseCActionClassEligible admits pause and nothing else", () => {
    for (const action of ALL_ACTIONS) {
      expect(isPhaseCActionClassEligible(action), action).toBe(action === "pause");
    }
  });

  it("class eligibility is the conjunction the wiring session flips on: seam + reversible + no-reset + mutating", () => {
    // pause satisfies all four legs today; if any leg drifts, eligibility must collapse to false
    expect(PHASE_C_EXECUTION_SEAM.pause?.reversibility).toBe("full");
    expect(ACTION_CONTRACT.pause.resetsLearning).toBe("no");
    expect(isMutating("pause")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test -- action-contract`
Expected: FAIL, `PHASE_C_EXECUTION_SEAM` / `isPhaseCActionClassEligible` not exported.

- [ ] **Step 3: Implement the seam**

Append to `packages/ad-optimizer/src/action-contract.ts`:

```ts
/**
 * PHASE-C (designed-but-unwired; Riley v3 slice 5): execution-time contract for a
 * self-executed action class. Declarations only, strings not machinery; consumed by
 * nothing live. The submit-request mapper lives in
 * apps/api/src/services/workflows/riley-pause-submit-request.ts (CanonicalSubmitRequest
 * is a core type and this package is Layer 2: schemas only).
 */
export interface PhaseCExecutionContract {
  /**
   * PLATFORM-STATE reversibility: can the ad-platform state be cleanly restored?
   * Deliberately NOT outcome reversibility: lost delivery, auction re-entry effects,
   * and missed bookings during the action window are not reversed by the rollback.
   */
  reversibility: "full" | "partial" | "none";
  /** Human-readable inverse action the executor (or operator) applies to undo. */
  rollbackPlan: string;
  /** What improving looks like after the action lands. */
  successMetric: string;
  /** Abort signals the Phase-C executor must watch post-action. */
  guardrailMetrics: string[];
}

/**
 * Sparse on purpose: an action gets an entry only when it earns execution
 * (parent spec slice 5: pause is the first self-owned reversible class).
 * Do NOT backfill entries for actions nobody has reviewed for execution.
 */
export const PHASE_C_EXECUTION_SEAM: Partial<
  Record<AdRecommendationAction, PhaseCExecutionContract>
> = {
  pause: {
    reversibility: "full",
    rollbackPlan:
      "Resume the campaign (status back to ACTIVE). This reverses the platform state only, not any lost delivery during the paused window; delivery restarts without a learning reset.",
    successMetric: "Account-level cost per booked falls once the leaking campaign stops spending.",
    guardrailMetrics: [
      "account-level booked conversions drop beyond the paused campaign's share",
      "remaining campaigns' spend does not absorb the freed budget within the window",
    ],
  },
};

/**
 * CLASS eligibility ONLY (the "first self-owned reversible action class" gate,
 * parent spec slice 5): is this ACTION CLASS structurally safe to ever self-execute?
 * Phase-C wiring consumes THIS predicate verbatim; class eligibility is never
 * re-derived from scattered conditions.
 *
 * It deliberately does NOT decide request- or execution-eligibility. Approval policy,
 * org entitlement, evidence sufficiency, attribution confidence, learning/stability
 * windows, shared-budget/CBO membership, and budget-absorption risk are all
 * wiring-session concerns (GovernanceGate + the executor), NOT encoded here.
 * All four legs must hold: seam entry exists, platform-state reversible, never
 * resets learning, and actually mutating.
 */
export function isPhaseCActionClassEligible(action: AdRecommendationAction): boolean {
  const seam = PHASE_C_EXECUTION_SEAM[action];
  return (
    seam !== undefined &&
    seam.reversibility === "full" &&
    ACTION_CONTRACT[action].resetsLearning === "no" &&
    isMutating(action)
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @switchboard/ad-optimizer test -- action-contract`
Expected: PASS (existing contract tests plus the new describe block).

- [ ] **Step 5: Export from the package barrel**

In `packages/ad-optimizer/src/index.ts`, extend the existing action-contract block (lines 140-141). The barrel is the package's only export surface (no subpath exports in package.json) and the live handoff builder already imports from it; these additions are pure data + pure functions:

```ts
export {
  ACTION_CONTRACT,
  isMutating,
  isPhaseCActionClassEligible,
  PHASE_C_EXECUTION_SEAM,
} from "./action-contract.js";
export type { ActionContract, PhaseCExecutionContract } from "./action-contract.js";
```

- [ ] **Step 6: Full package test + typecheck, then commit**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build`
Expected: all green.

```bash
git add packages/ad-optimizer/src/action-contract.ts packages/ad-optimizer/src/action-contract.test.ts packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): phase-c execution seam for pause (designed-but-unwired)"
```

---

### Task 2: pause submit-request mapper in apps/api

**Files:**

- Create: `apps/api/src/services/workflows/riley-pause-submit-request.ts`
- Test: `apps/api/src/services/workflows/__tests__/riley-pause-submit-request.test.ts`

The ad-optimizer package must be built first (Task 1 Step 6 did) so the new exports resolve.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/workflows/__tests__/riley-pause-submit-request.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildRileyPauseSubmitRequest,
  UNWIRED_RILEY_PAUSE_INTENT,
} from "../riley-pause-submit-request.js";
import { buildRecommendationHandoffSubmitRequest } from "../recommendation-handoff-request.js";

// Destructive-family floor is { clicks: 50, conversions: 5, days: 7 }; this clears it.
const base = {
  organizationId: "org_x",
  recommendationId: "rec_9",
  campaignId: "camp_9",
  rationale: "spend with zero booked revenue for 30 days",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
};

const dep = { deploymentId: "dep_riley", skillSlug: "ad-optimizer" };

describe("buildRileyPauseSubmitRequest (PHASE-C seam, unwired)", () => {
  it("maps a pause recommendation onto the governed-path conventions", () => {
    const req = buildRileyPauseSubmitRequest(base, dep);
    expect(req).not.toBeNull();
    expect(req!.actor).toEqual({ id: "system", type: "system" });
    expect(req!.intent).toBe(UNWIRED_RILEY_PAUSE_INTENT);
    expect(req!.trigger).toBe("internal");
    expect(req!.surface).toEqual({ surface: "api" });
    expect(req!.idempotencyKey).toBe("mutate:riley:rec_9:pause");
    expect(req!.targetHint).toEqual({ deploymentId: "dep_riley", skillSlug: "ad-optimizer" });
  });

  it("carries the recommendation identity and evidence in the parameters", () => {
    const req = buildRileyPauseSubmitRequest(base, dep);
    expect(req!.parameters).toEqual({
      recommendationId: "rec_9",
      actionType: "pause",
      campaignId: "camp_9",
      rationale: "spend with zero booked revenue for 30 days",
      evidence: { clicks: 1000, conversions: 100, days: 30 },
    });
  });

  it("returns null (do NOT submit) below the destructive evidence floor", () => {
    const req = buildRileyPauseSubmitRequest(
      { ...base, evidence: { clicks: 49, conversions: 5, days: 7 } },
      dep,
    );
    expect(req).toBeNull();
  });

  it("is intentionally pause-only: no action parameter exists to widen it", () => {
    // The mapper hardcodes actionType "pause"; widening to other actions requires a
    // NEW seam entry + class-eligibility review, not a parameter change. Pinned by
    // the parameters shape above; this test documents the intent.
    const req = buildRileyPauseSubmitRequest(base, dep);
    expect((req!.parameters as { actionType: string }).actionType).toBe("pause");
  });
});

describe("convention parity with the live handoff builder (anti-rot tripwire)", () => {
  // Build BOTH requests from equivalent fixtures; if the live builder's conventions
  // drift (actor, trigger, surface, targetHint shape, idempotency-key structure),
  // this test breaks even though the pause mapper is unwired.
  const live = buildRecommendationHandoffSubmitRequest(
    {
      organizationId: base.organizationId,
      recommendationId: base.recommendationId,
      actionType: "refresh_creative",
      campaignId: base.campaignId,
      rationale: base.rationale,
      evidence: base.evidence,
      learningPhaseActive: false,
      brief: { productDescription: "p", targetAudience: "a" },
    },
    dep,
  )!;
  const seam = buildRileyPauseSubmitRequest(base, dep)!;

  it("both requests exist (fixtures clear every abstention leg)", () => {
    expect(live).not.toBeNull();
    expect(seam).not.toBeNull();
  });

  it("seeded system principal is identical, verbatim", () => {
    expect(seam.actor).toEqual(live.actor);
  });

  it("trigger and surface metadata are identical", () => {
    expect(seam.trigger).toBe(live.trigger);
    expect(seam.surface).toEqual(live.surface);
  });

  it("targetHint threads the resolved deployment with the same key set", () => {
    expect(Object.keys(seam.targetHint!).sort()).toEqual(Object.keys(live.targetHint!).sort());
    expect(seam.targetHint).toEqual(live.targetHint);
  });

  it("idempotency keys share the 4-segment <ns>:riley:<recId>:<action> structure", () => {
    const liveParts = live.idempotencyKey!.split(":");
    const seamParts = seam.idempotencyKey!.split(":");
    expect(liveParts).toHaveLength(4);
    expect(seamParts).toHaveLength(4);
    expect(seamParts[1]).toBe(liveParts[1]); // "riley"
    expect(seamParts[2]).toBe(base.recommendationId);
    expect(seamParts[3]).toBe("pause");
    expect(seamParts[0]).not.toBe(liveParts[0]); // distinct namespace, no key collision
  });

  it("intents are distinct: pause is NOT the creative handoff", () => {
    expect(seam.intent).not.toBe(live.intent);
    expect(seam.intent.startsWith("adoptimizer.")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api test -- riley-pause-submit-request`
Expected: FAIL, cannot resolve `../riley-pause-submit-request.js`.

- [ ] **Step 3: Implement the mapper**

Create `apps/api/src/services/workflows/riley-pause-submit-request.ts`:

```ts
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import {
  isPhaseCActionClassEligible,
  meetsEvidenceFloor,
  type Evidence,
} from "@switchboard/ad-optimizer";

// UNWIRED: nothing live imports this module or this string. The prefix in the symbol
// name is deliberate; do not "clean it up" until the Phase-C wiring session resolves
// the final intent name, Riley-self deployment resolution, and governance seeding.
// PHASE-C: intent name + Riley deployment resolution + governance seeding unresolved.
export const UNWIRED_RILEY_PAUSE_INTENT = "adoptimizer.campaign.pause";

export interface RileyPauseSubmitInput {
  organizationId: string;
  recommendationId: string;
  campaignId: string;
  rationale: string;
  evidence: Evidence;
}

/**
 * PHASE-C SEAM (Riley v3 slice 5): designed-but-unwired, and intentionally PAUSE-ONLY.
 * Build the canonical submit request for Riley SELF-EXECUTING a pause through the
 * governed path. No live code calls this; the PRIMARY safety invariant is "no live
 * importer" (grep-proven per PR on both this module path and the intent string). As
 * defense in depth the governance engine is expected to default-deny the unregistered
 * intent, but this seam does not lean on that as a guarantee. The convention-parity
 * test ties this builder to the live handoff builder (recommendation-handoff-request.ts)
 * so drift in the real conventions breaks CI.
 *
 * Widening beyond pause requires a NEW PHASE_C_EXECUTION_SEAM entry and class review,
 * not a parameter on this function.
 *
 * Conventions mirrored from the live builder, on purpose:
 * - seeded `{ id: "system", type: "system" }` principal VERBATIM (trace root; a
 *   bespoke system:<x> id hard-denies with empty outputs);
 * - `deployment` REQUIRED and threaded into targetHint (the top-level resolver does
 *   not fall back to api-direct; it must be Riley's OWN per-org deployment, never
 *   Mira's creative deployment);
 * - idempotency key `mutate:riley:<recommendationId>:pause` mirrors the live
 *   `handoff:riley:<recId>:<action>` 4-segment shape under a distinct namespace.
 *   Both assume recommendation ids are globally unique, which holds: they are Prisma
 *   cuid() primary keys, so no org segment is needed;
 * - returns NULL on abstention (below the destructive-family evidence floor, or the
 *   action class is not Phase-C eligible); the caller MUST then not submit. The floor
 *   is the package-wide family-keyed policy (pause is explicitly destructive,
 *   {clicks: 50, conversions: 5, days: 7}); it is the recommendation-time MINIMUM and
 *   the wiring session may raise the execution floor. The live builder's learning-lock
 *   leg only fires for resetsLearning === "yes" actions; class eligibility already
 *   requires "no", so that leg is structurally inert here and not replicated.
 * - the wiring session's call site MUST branch on `"approvalRequired" in response`
 *   before destructuring (ingress-route convention), and pause submits are expected
 *   to park for approval until trust is earned.
 */
export function buildRileyPauseSubmitRequest(
  input: RileyPauseSubmitInput,
  deployment: { deploymentId: string; skillSlug: string },
): CanonicalSubmitRequest | null {
  if (!isPhaseCActionClassEligible("pause")) {
    return null;
  }
  if (!meetsEvidenceFloor("pause", input.evidence)) {
    return null;
  }

  return {
    organizationId: input.organizationId,
    actor: { id: "system", type: "system" },
    intent: UNWIRED_RILEY_PAUSE_INTENT,
    parameters: {
      recommendationId: input.recommendationId,
      actionType: "pause",
      campaignId: input.campaignId,
      rationale: input.rationale,
      evidence: input.evidence,
    },
    trigger: "internal",
    surface: { surface: "api" },
    idempotencyKey: `mutate:riley:${input.recommendationId}:pause`,
    targetHint: { deploymentId: deployment.deploymentId, skillSlug: deployment.skillSlug },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter api test -- riley-pause-submit-request`
Expected: PASS, all shape + abstention + parity tests.

- [ ] **Step 5: Unwired proof + api build, then commit**

Run and capture output for the PR description:

```bash
grep -rn "PlatformIngress" packages/ad-optimizer/src || echo "CLEAN: no ingress reference in ad-optimizer"
grep -rln "riley-pause-submit-request" apps packages --include="*.ts" | grep -v __tests__ | grep -v "riley-pause-submit-request.ts" || echo "CLEAN: mapper has no live importer"
grep -rln "adoptimizer.campaign.pause" apps packages --include="*.ts" | grep -v __tests__ | grep -v "riley-pause-submit-request.ts" || echo "CLEAN: intent string has no stray duplicate"
pnpm --filter api build && pnpm --filter api test
```

Expected: all three CLEAN lines, build green, full api suite green.

```bash
git add apps/api/src/services/workflows/riley-pause-submit-request.ts apps/api/src/services/workflows/__tests__/riley-pause-submit-request.test.ts
git commit -m "feat(api): riley pause submit-request mapper (phase-c seam, unwired)"
```

---

### Task 3: docs, repo-wide verification, PR

**Files:**

- Add: `docs/superpowers/specs/2026-06-05-riley-v3-slice5-phase-c-seam-design.md` (already written)
- Add: `docs/superpowers/plans/2026-06-05-riley-v3-slice5-phase-c-seam.md` (this file)

- [ ] **Step 1: Commit the docs**

```bash
git add docs/superpowers/specs/2026-06-05-riley-v3-slice5-phase-c-seam-design.md docs/superpowers/plans/2026-06-05-riley-v3-slice5-phase-c-seam.md
git commit -m "docs(riley): slice-5 phase-c seam design + plan"
```

- [ ] **Step 2: Repo-wide gates**

```bash
pnpm test && pnpm typecheck && pnpm format:check && pnpm arch:check && pnpm lint
```

Expected: green (known flakes: pg_advisory_xact_lock integrity tests, chat attribution under load; rerun before investigating). Existing evals (12+10 golden, 6 arbitration) must pass UNCHANGED.

- [ ] **Step 3: Branch-context check + push + PR**

```bash
git branch --show-current   # must be feat/riley-v3-slice5-phase-c-seam
git status --short          # no stray files
git diff origin/main...HEAD --stat
git push -u origin feat/riley-v3-slice5-phase-c-seam
```

PR title: `feat(api,ad-optimizer): riley v3 slice 5 phase-c seam (designed-but-unwired)`
PR body must include: the three CLEAN grep proofs, "advisory-only invariant holds: zero new mutating callers", the apps/api placement deviation rationale (Layer-2 cannot import core; live handoff builder precedent), the defensive-naming rationale (semantic gravity), and the deferred Phase-C open questions (final intent name, Riley-self deployment resolution, governance seeding, execution-time evidence floor).

- [ ] **Step 4: CI green, code review, squash-merge, teardown**

Address review findings in-branch (ship clean, no follow-up deferrals). After merge:

```bash
git worktree remove /Users/jasonli/switchboard/.claude/worktrees/riley-v3-slice5 && git worktree prune
```
