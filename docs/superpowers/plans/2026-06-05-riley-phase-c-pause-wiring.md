# Riley Phase-C Pause Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the slice-5 Phase-C seam live in its safest form: Riley's arbitration-primary pause submits through PlatformIngress, parks for mandatory human approval, and approval dispatches a real Meta pause, behind a per-org flag defaulting OFF.

**Architecture:** Three sequential PRs. PR-1 ships the dark spine (intent registration + governance seeding + hardened executor; zero callers). PR-2 ships the initiator (flag-gated submit-and-park from the weekly audit cron, primary-only, park-truth returned) plus the auditable flag-toggle script. PR-3 ships strict-truth ownership (`riley_self` emitted only for a recommendation whose submit actually parked). Core path: `PlatformIngress.submit` -> seeded `require_approval(mandatory)` -> parked lifecycle -> `respondToParkedLifecycle` -> `runDispatch` -> `WorkflowMode` handler -> staleness/org/status guards -> `MetaAdsClient.updateCampaignStatus(campaignId, "PAUSED")`.

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo), Zod, Vitest (mocked Prisma in db tests), Fastify apps layer, Prisma JSON `governanceSettings` column (no migration needed).

**Design doc:** `docs/superpowers/specs/2026-06-05-riley-phase-c-pause-wiring-design.md` (rev 2; rides in PR-1 together with this plan).

**Verified-against:** origin/main `0efdfe7e` (slice-5 seam #927). All file:line anchors below were read at that SHA.

**Rev 2 (2026-06-06) review incorporation:** stale-approval cap + campaign pre-read + org-isolation guard in the executor; policy-ordering decomposition legs in the gate test; strict-truth riley_self (park-fact-based, submitter returns park truth); auditable flag-toggle script; `RileyPauseEvidence` alias; named never-auto-executes test; candidate edge tests; `campaignEvidenceByCampaign` variable rename; typo-grep gauntlet step; rollout rule (no org flips ON until PR-3 merged). Pushed back with evidence on one item: `parameterSchema` is decorative platform-wide (zero non-test consumers in `packages/core/src`), so the registration keeps `{}` + comment instead of a drift-prone hand-written schema.

---

## Phase 0: Worktree setup (once, before PR-1)

- [ ] **Step 0.1: Create worktree**

```bash
cd /Users/jasonli/switchboard
git worktree add .claude/worktrees/riley-phase-c-wiring -b feat/riley-phase-c-pause-wiring origin/main
cd .claude/worktrees/riley-phase-c-wiring
pnpm worktree:init
```

Known traps (all hit in prior sessions):
- `worktree-init` mangles `apps/dashboard/.env.local`: DATABASE_URL doubled (~line 13), `DEV_BYPASS_AUTH` commented (~line 35). Fix both lines after init.
- Run `pnpm install` manually afterward (vitest is missing otherwise).
- Run FULL `pnpm build` before any package test (stale-dist false failures across ad-optimizer/api otherwise).
- `.agent/tools` needs its own `pnpm install --ignore-workspace` for check-routes locally.

- [ ] **Step 0.2: Baseline checks**

```bash
pnpm build && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter api test
.agent/tools/check-routes || true   # baseline; this plan adds no HTTP routes
git log --oneline -3                # confirm HEAD == origin/main 0efdfe7e
```

Expected: green build; ad-optimizer + api suites pass; check-routes reports only pre-existing findings.

- [ ] **Step 0.3: Verify two platform behaviors the executor guards depend on**

Read in the worktree and note findings in the PR body:

1. Does `respondToParkedLifecycle` (`packages/core/src/approval/respond-to-parked-lifecycle.ts`) enforce the lifecycle `expiresAt` (the 24h park expiry from `platform-ingress.ts:284`)? If yes, the executor's 48h cap is a pure backstop; if no, it is the only stale guard. Either way the cap ships; the loop test pins the real behavior (Task 1.8 expiry leg).
2. Confirm `PrismaDeploymentStore.findById` (or the store the closure uses) returns `organizationId` so the org-isolation compare is implementable as written in Task 1.6.

- [ ] **Step 0.4: Move design doc + this plan into the worktree**

The docs were drafted in the primary working tree (untracked) while the worktree was pending. Copy them in (they ride in PR-1):

```bash
cp /Users/jasonli/switchboard/docs/superpowers/specs/2026-06-05-riley-phase-c-pause-wiring-design.md docs/superpowers/specs/
cp /Users/jasonli/switchboard/docs/superpowers/plans/2026-06-05-riley-phase-c-pause-wiring.md docs/superpowers/plans/
rm /Users/jasonli/switchboard/docs/superpowers/specs/2026-06-05-riley-phase-c-pause-wiring-design.md
rm /Users/jasonli/switchboard/docs/superpowers/plans/2026-06-05-riley-phase-c-pause-wiring.md
git add docs/ && git commit -m "docs(riley): phase-c pause wiring design + plan"
```

---

## PR-1: Dark spine (intent + governance seed + hardened executor; no initiator)

Branch: `feat/riley-phase-c-pause-wiring` (this worktree's branch). PR title: `feat(api,ad-optimizer,db,schemas): riley phase-c pause wiring pr-1 dark spine`.

### Task 1.1: Execution evidence floor (Layer 2, single source)

**Files:**
- Create: `packages/ad-optimizer/src/riley-pause-execution-floor.ts`
- Create: `packages/ad-optimizer/src/riley-pause-execution-floor.test.ts`
- Modify: `packages/ad-optimizer/src/index.ts` (barrel: add exports)

The floor must live in Layer 2 (not apps/api) because three consumers need it: the apps/api submit builder (PR-1), the executor re-check (PR-1), and the strict-truth dispatch gate (PR-2). The seam doc blesses raising the execution floor outside `evidence-floor.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ad-optimizer/src/riley-pause-execution-floor.test.ts
import { describe, it, expect } from "vitest";
import {
  RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR,
  meetsRileyPauseExecutionFloor,
} from "./riley-pause-execution-floor.js";
import { EVIDENCE_FLOORS } from "./evidence-floor.js";

describe("riley pause execution evidence floor", () => {
  it("is a deliberate RAISE over the destructive recommendation floor (volume axes only)", () => {
    const rec = EVIDENCE_FLOORS.destructive;
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.clicks).toBeGreaterThan(rec.clicks);
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.conversions).toBeGreaterThan(rec.conversions);
    // days MUST equal the recommendation floor: the weekly audit window is 7 days
    // (audit-runner windowDays), so a higher days floor would be permanently inert.
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.days).toBe(rec.days);
  });

  it("pins the exact raised values", () => {
    expect(RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR).toEqual({ clicks: 100, conversions: 10, days: 7 });
  });

  it("boundary: meets at exactly the floor", () => {
    expect(meetsRileyPauseExecutionFloor({ clicks: 100, conversions: 10, days: 7 })).toBe(true);
  });

  it.each([
    [{ clicks: 99, conversions: 10, days: 7 }],
    [{ clicks: 100, conversions: 9, days: 7 }],
    [{ clicks: 100, conversions: 10, days: 6 }],
  ])("boundary: fails just under the floor %j", (evidence) => {
    expect(meetsRileyPauseExecutionFloor(evidence)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/ad-optimizer test -- riley-pause-execution-floor
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// packages/ad-optimizer/src/riley-pause-execution-floor.ts
import type { Evidence } from "./evidence-floor.js";

/**
 * PHASE-C wiring: the EXECUTION evidence floor for a Riley self-submitted pause.
 * Deliberately RAISED above the destructive recommendation floor ({clicks: 50,
 * conversions: 5, days: 7}, evidence-floor.ts): advising a pause and asking to
 * EXECUTE one are different acts; weak-evidence pauses stay advisory.
 *
 * `days` stays 7 ON PURPOSE: the weekly audit's evidence window IS 7 days
 * (audit-runner.ts windowDays), so any higher days floor would make the feature
 * permanently inert (the producer-population trap). Raise volume axes only.
 *
 * Consumed by: the apps/api submit builder (abstention), the pause executor
 * (defense-in-depth re-check), and the PR-2 dispatch gate. ONE constant so the
 * sites cannot drift.
 */
export const RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR: Evidence = {
  clicks: 100,
  conversions: 10,
  days: 7,
};

export function meetsRileyPauseExecutionFloor(evidence: Evidence): boolean {
  return (
    evidence.clicks >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.clicks &&
    evidence.conversions >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.conversions &&
    evidence.days >= RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR.days
  );
}
```

Barrel addition in `packages/ad-optimizer/src/index.ts` (append near the slice-5 exports):

```ts
// Phase-C wiring: raised execution floor for the self-submitted pause.
export {
  RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR,
  meetsRileyPauseExecutionFloor,
} from "./riley-pause-execution-floor.js";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/ad-optimizer test -- riley-pause-execution-floor
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/riley-pause-execution-floor.ts packages/ad-optimizer/src/riley-pause-execution-floor.test.ts packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): raised execution evidence floor for riley pause self-submission"
```

### Task 1.2: Parameters contract in schemas (with the evidence alias seam)

**Files:**
- Create: `packages/schemas/src/riley-pause-execution.ts`
- Create: `packages/schemas/src/__tests__/riley-pause-execution.test.ts`
- Modify: `packages/schemas/src/index.ts` (barrel export, mirror how `recommendation-handoff.js` is exported)

- [ ] **Step 1: Write the failing test**

```ts
// packages/schemas/src/__tests__/riley-pause-execution.test.ts
import { describe, it, expect } from "vitest";
import { RileyPauseExecutionInput, RileyPauseEvidence } from "../riley-pause-execution.js";
import { RecommendationHandoffEvidence } from "../recommendation-handoff.js";

describe("RileyPauseExecutionInput", () => {
  const valid = {
    recommendationId: "rec_1",
    actionType: "pause",
    campaignId: "camp_1",
    rationale: "spend with zero booked revenue",
    evidence: { clicks: 100, conversions: 10, days: 7 },
  };

  it("parses the executor payload", () => {
    expect(RileyPauseExecutionInput.parse(valid)).toEqual(valid);
  });

  it("rejects any non-pause action (the seam is pause-only)", () => {
    expect(() =>
      RileyPauseExecutionInput.parse({ ...valid, actionType: "refresh_creative" }),
    ).toThrow();
  });

  it("rejects a missing campaignId", () => {
    expect(() => RileyPauseExecutionInput.parse({ ...valid, campaignId: "" })).toThrow();
  });

  it("rejects malformed evidence", () => {
    expect(() =>
      RileyPauseExecutionInput.parse({ ...valid, evidence: { clicks: 100 } }),
    ).toThrow();
  });

  it("RileyPauseEvidence is its own named seam (today aliasing the handoff shape)", () => {
    // If pause evidence ever diverges from handoff evidence, change the alias to
    // a real schema; consumers already import the pause name.
    expect(RileyPauseEvidence).toBe(RecommendationHandoffEvidence);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/schemas test -- riley-pause-execution
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// packages/schemas/src/riley-pause-execution.ts
import { z } from "zod";
import { RecommendationHandoffEvidence } from "./recommendation-handoff.js";

/**
 * PHASE-C wiring: the parameters contract for `adoptimizer.campaign.pause`
 * (Riley self-executing a pause through the governed path). Mirrors the
 * RecommendationHandoffInput projection shape, with actionType pinned to the
 * literal "pause": the seam is pause-only by design (widening requires a new
 * PHASE_C_EXECUTION_SEAM entry + class review, not a parameter change).
 */

/** Pause execution owns its own evidence name. Today it aliases the handoff
 * evidence shape (which mirrors ad-optimizer's `Evidence`); the named seam
 * exists so the two can diverge without a consumer migration. */
export const RileyPauseEvidence = RecommendationHandoffEvidence;
export type RileyPauseEvidence = z.infer<typeof RileyPauseEvidence>;

export const RileyPauseExecutionInput = z.object({
  recommendationId: z.string().min(1),
  actionType: z.literal("pause"),
  campaignId: z.string().min(1),
  rationale: z.string().min(1),
  evidence: RileyPauseEvidence,
});
export type RileyPauseExecutionInput = z.infer<typeof RileyPauseExecutionInput>;
```

Barrel: add to `packages/schemas/src/index.ts` next to the `recommendation-handoff.js` export line (mirror its style):

```ts
export * from "./riley-pause-execution.js";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @switchboard/schemas test -- riley-pause-execution
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/riley-pause-execution.ts packages/schemas/src/__tests__/riley-pause-execution.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): riley pause execution input contract"
```

### Task 1.3: Governance policy seed builders

**Files:**
- Create: `packages/db/src/seed/riley-pause-governance.ts`
- Create: `packages/db/src/seed/seed-riley-pause-governance.test.ts`
- Modify: `packages/db/src/index.ts` (export the builders, mirror `recommendation-handoff-governance.ts` exports)
- Modify: `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts` (seed both policies)

- [ ] **Step 1: Write the failing test**

Co-located, mirroring `seed-mira-creative-deployment.test.ts` style (mocked PrismaClient with `vi.fn()` per model method; CI has no Postgres):

```ts
// packages/db/src/seed/seed-riley-pause-governance.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  RILEY_PAUSE_ALLOW_POLICY_RULE,
  RILEY_PAUSE_APPROVAL_POLICY_RULE,
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
  rileyPauseAllowPolicyId,
  rileyPauseApprovalPolicyId,
} from "./riley-pause-governance.js";
import { seedRileyAdOptimizerDeployment } from "./seed-riley-ad-optimizer-deployment.js";

describe("riley pause governance seed builders", () => {
  it("allow policy is org-scoped, anchored, effect allow", () => {
    const p = buildRileyPauseAllowPolicyInput("org_1");
    expect(p.id).toBe(rileyPauseAllowPolicyId("org_1"));
    expect(p.organizationId).toBe("org_1");
    expect(p.effect).toBe("allow");
    expect(p.active).toBe(true);
    expect(p.rule).toBe(RILEY_PAUSE_ALLOW_POLICY_RULE);
  });

  it("approval policy is require_approval with MANDATORY requirement", () => {
    const p = buildRileyPauseApprovalPolicyInput("org_1");
    expect(p.id).toBe(rileyPauseApprovalPolicyId("org_1"));
    expect(p.effect).toBe("require_approval");
    expect(p.approvalRequirement).toBe("mandatory");
  });

  it("rules are anchored + escaped so they match the intent exactly", () => {
    const value = RILEY_PAUSE_ALLOW_POLICY_RULE.conditions[0]!.value;
    const re = new RegExp(value);
    expect(re.test("adoptimizer.campaign.pause")).toBe(true);
    expect(re.test("adoptimizer.campaign.pause.extra")).toBe(false);
    expect(re.test("xadoptimizer.campaign.pause")).toBe(false);
    expect(re.test("adoptimizerXcampaignXpause")).toBe(false); // dots are escaped
    expect(RILEY_PAUSE_APPROVAL_POLICY_RULE.conditions[0]!.value).toBe(value);
  });
});

describe("seedRileyAdOptimizerDeployment seeds the pause policies", () => {
  it("upserts deployment + allow + mandatory approval policies; never seeds the dispatch flag", async () => {
    const upsertPolicy = vi.fn().mockResolvedValue({});
    const upsertDeployment = vi.fn().mockResolvedValue({ id: "dep_1" });
    const prisma = {
      agentListing: { findUnique: vi.fn().mockResolvedValue({ id: "listing_1" }) },
      agentDeployment: { upsert: upsertDeployment },
      policy: { upsert: upsertPolicy },
    };
    await seedRileyAdOptimizerDeployment(prisma as never, "org_1");

    const ids = upsertPolicy.mock.calls.map(
      (c: [{ where: { id: string } }]) => c[0].where.id,
    );
    expect(ids).toContain(rileyPauseAllowPolicyId("org_1"));
    expect(ids).toContain(rileyPauseApprovalPolicyId("org_1"));
    const approvalCall = upsertPolicy.mock.calls.find(
      (c: [{ where: { id: string } }]) => c[0].where.id === rileyPauseApprovalPolicyId("org_1"),
    )!;
    expect(
      (approvalCall[0] as { create: { approvalRequirement: string } }).create.approvalRequirement,
    ).toBe("mandatory");

    // The per-org dispatch flag is capability assignment: the seed must NOT set it.
    const depCreate = (upsertDeployment.mock.calls[0]![0] as {
      create: { governanceSettings: Record<string, unknown> };
    }).create;
    expect(depCreate.governanceSettings).not.toHaveProperty("pauseSelfExecutionEnabled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @switchboard/db test -- riley-pause-governance
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// packages/db/src/seed/riley-pause-governance.ts
/**
 * Canonical governance config for Riley's Phase-C pause self-execution
 * (`adoptimizer.campaign.pause`). Two policies, both required, mirroring
 * recommendation-handoff-governance.ts:
 *
 *  1. allow policy - a workflow intent matches no other seeded policy, so the
 *     engine default-denies it. This org-scoped allow makes the pause governed
 *     (by the approval policy below) rather than hard-denied.
 *  2. require_approval(mandatory) policy - a Riley-initiated pause mutates live
 *     ad-platform spend state, so it ALWAYS parks for a human. "mandatory" is
 *     the load-bearing word: Riley's deployment is seeded
 *     trustLevelOverride:"autonomous", and the spend-approval autonomy lever
 *     (spend-approval-threshold.ts) relaxes ONLY approvalLevel "standard"
 *     decisions; mandatory survives it (and a pause carries no spendAmount
 *     anyway). NOT system_auto_approved.
 *
 * NEVER seed one without the other: allow alone would EXECUTE the pause with no
 * human (the gate test pins this decomposition); approval alone default-denies.
 *
 * Both rules are anchored + escaped: the rule-evaluator does an unanchored
 * `new RegExp(value).test(actionType)`.
 *
 * Shared by the seed (seed-riley-ad-optimizer-deployment.ts) AND the apps/api
 * real-gate test so the two cannot drift.
 */

export const RILEY_PAUSE_ALLOW_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.pause$",
    },
  ],
};

export function rileyPauseAllowPolicyId(organizationId: string): string {
  return `policy_allow_riley_pause_${organizationId}`;
}

export function buildRileyPauseAllowPolicyInput(organizationId: string) {
  return {
    id: rileyPauseAllowPolicyId(organizationId),
    name: "Allow Riley campaign-pause self-submission",
    description:
      "Riley's governed pause self-submission is governed by mandatory approval, not hard-denied.",
    organizationId,
    priority: 50,
    active: true,
    rule: RILEY_PAUSE_ALLOW_POLICY_RULE,
    effect: "allow",
  };
}

export const RILEY_PAUSE_APPROVAL_POLICY_RULE = {
  conditions: [
    {
      field: "actionType",
      operator: "matches" as const,
      value: "^adoptimizer\\.campaign\\.pause$",
    },
  ],
};

export function rileyPauseApprovalPolicyId(organizationId: string): string {
  return `policy_require_approval_riley_pause_${organizationId}`;
}

/**
 * Org-scoped mandatory-approval policy for the pause - the REAL gate that keeps
 * a human between Riley's intent and the Meta write.
 */
export function buildRileyPauseApprovalPolicyInput(organizationId: string) {
  return {
    id: rileyPauseApprovalPolicyId(organizationId),
    name: "Require human approval for a Riley campaign pause",
    description:
      "A Riley-initiated campaign pause mutates live ad spend state and always requires mandatory human approval.",
    organizationId,
    priority: 40,
    active: true,
    rule: RILEY_PAUSE_APPROVAL_POLICY_RULE,
    effect: "require_approval",
    approvalRequirement: "mandatory",
  };
}
```

Wire into `packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts` (after the deployment upsert, mirroring the seed-mira upsert pattern exactly):

```ts
import {
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
} from "./riley-pause-governance.js";

// ... inside seedRileyAdOptimizerDeployment, after the agentDeployment.upsert:

  // Phase-C pause self-execution governance (adoptimizer.campaign.pause): a
  // workflow intent default-denies without an allow policy, and a Riley-initiated
  // pause mutates live spend state, so seed the allow + mandatory-approval
  // policies together (mirrors the handoff gate; never one without the other).
  // The per-org dispatch flag (governanceSettings.pauseSelfExecutionEnabled) is
  // deliberately NOT seeded: the governed path is armed, the initiator stays OFF
  // until an operator flips the org via scripts/riley-pause-flag.ts (auditable).
  // Idempotent on the deterministic per-org policy ids.
  const { id: pauseAllowId, ...pauseAllowData } = buildRileyPauseAllowPolicyInput(orgId);
  await prisma.policy.upsert({
    where: { id: pauseAllowId },
    create: { id: pauseAllowId, ...pauseAllowData },
    update: pauseAllowData,
  });

  const { id: pauseApprovalId, ...pauseApprovalData } =
    buildRileyPauseApprovalPolicyInput(orgId);
  await prisma.policy.upsert({
    where: { id: pauseApprovalId },
    create: { id: pauseApprovalId, ...pauseApprovalData },
    update: pauseApprovalData,
  });
```

Export from `packages/db/src/index.ts` (mirror the `recommendation-handoff-governance.js` export block):

```ts
export {
  RILEY_PAUSE_ALLOW_POLICY_RULE,
  RILEY_PAUSE_APPROVAL_POLICY_RULE,
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
  rileyPauseAllowPolicyId,
  rileyPauseApprovalPolicyId,
} from "./seed/riley-pause-governance.js";
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @switchboard/db test -- riley-pause-governance
pnpm --filter @switchboard/db test   # full package: existing seed tests must stay green
```

Expected: PASS. If an existing `seed-riley-ad-optimizer-deployment` test pins the exact prisma-call count, update it deliberately (two extra policy upserts).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seed/riley-pause-governance.ts packages/db/src/seed/seed-riley-pause-governance.test.ts packages/db/src/seed/seed-riley-ad-optimizer-deployment.ts packages/db/src/index.ts
git commit -m "feat(db): seed riley pause allow + mandatory approval policies with the riley deployment"
```

### Task 1.4: Rename the seam symbol + add the execution floor to the builder

**Files:**
- Modify: `apps/api/src/services/workflows/riley-pause-submit-request.ts`
- Modify: `apps/api/src/services/workflows/__tests__/riley-pause-submit-request.test.ts`

- [ ] **Step 1: Update the test first**

In the existing test file:
1. Change the import to `RILEY_PAUSE_INTENT` (from `UNWIRED_RILEY_PAUSE_INTENT`).
2. The `base` fixture evidence `{clicks: 1000, conversions: 100, days: 30}` already clears the raised floor; keep it.
3. Add execution-floor tests:

```ts
import { RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR } from "@switchboard/ad-optimizer";

  it("returns null below the RAISED execution floor even when the recommendation floor passes", () => {
    // Clears destructive {50,5,7} but NOT execution {100,10,7}.
    const req = buildRileyPauseSubmitRequest(
      { ...base, evidence: { clicks: 99, conversions: 9, days: 7 } },
      dep,
    );
    expect(req).toBeNull();
  });

  it("submits at exactly the execution floor", () => {
    const req = buildRileyPauseSubmitRequest(
      { ...base, evidence: RILEY_PAUSE_EXECUTION_EVIDENCE_FLOOR },
      dep,
    );
    expect(req).not.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter api test -- riley-pause-submit-request
```

Expected: FAIL (RILEY_PAUSE_INTENT not exported; execution-floor test red).

- [ ] **Step 3: Update the module**

In `apps/api/src/services/workflows/riley-pause-submit-request.ts`:

1. Rename the export and replace the UNWIRED comment block:

```ts
import type { CanonicalSubmitRequest } from "@switchboard/core/platform";
import {
  isPhaseCActionClassEligible,
  meetsEvidenceFloor,
  meetsRileyPauseExecutionFloor,
  type Evidence,
} from "@switchboard/ad-optimizer";

// PHASE-C WIRED (2026-06 wiring session): registered in
// bootstrap/contained-workflows.ts, governed by the seeded allow +
// require_approval(mandatory) policies (packages/db/src/seed/
// riley-pause-governance.ts), executed on approval by
// riley-pause-execution-workflow.ts. The initiator is the weekly-audit cron
// (riley-pause-dispatch seam), flag-gated per org and OFF by default.
export const RILEY_PAUSE_INTENT = "adoptimizer.campaign.pause";
```

2. In the doc comment, replace the "wiring session may raise the execution floor" sentence with: "The execution floor IS raised here: `meetsRileyPauseExecutionFloor` ({clicks: 100, conversions: 10, days: 7}); the family floor stays as the inner belt."
3. Add the floor leg to the builder body:

```ts
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
  if (!meetsRileyPauseExecutionFloor(input.evidence)) {
    return null;
  }
  // ... (return object unchanged, intent: RILEY_PAUSE_INTENT)
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter api test -- riley-pause-submit-request
```

Expected: PASS, including the untouched convention-parity block.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/workflows/riley-pause-submit-request.ts apps/api/src/services/workflows/__tests__/riley-pause-submit-request.test.ts
git commit -m "feat(api): riley pause submit builder goes live with raised execution floor"
```

### Task 1.5: MetaAdsClient.getCampaignStatus (read-only pre-read)

**Files:**
- Modify: `packages/ad-optimizer/src/meta-ads-client.ts`
- Test: find the client's existing test file (`grep -rln "MetaAdsClient" packages/ad-optimizer/src --include="*.test.ts"`) and extend it; if none exists, create `packages/ad-optimizer/src/meta-ads-client.test.ts` with fetch mocked via `vi.stubGlobal("fetch", ...)`.

- [ ] **Step 1: Write the failing test**

```ts
it("getCampaignStatus reads status + effective_status for one campaign", async () => {
  const fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "camp_1", status: "ACTIVE", effective_status: "ACTIVE" }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  const client = new MetaAdsClient({ accessToken: "tok", accountId: "act_1" });
  const status = await client.getCampaignStatus("camp_1");
  expect(status).toEqual({ status: "ACTIVE", effectiveStatus: "ACTIVE" });
  const url = (fetchSpy.mock.calls[0]![0] as string);
  expect(url).toContain("/camp_1?fields=status");
});

it("getCampaignStatus returns null on a Meta error (degrade, do not throw)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "nope", type: "x", code: 100 } }), { status: 400 })),
  );
  const client = new MetaAdsClient({ accessToken: "tok", accountId: "act_1" });
  expect(await client.getCampaignStatus("camp_1")).toBeNull();
});
```

- [ ] **Step 2: Implement** (next to `getAdCampaignId`, same degrade-to-null discipline):

```ts
  /**
   * Read one campaign's status (Phase-C pause executor pre-read). Degrades to
   * null on any error: the pause write itself is the honest test; a status-read
   * blip must not block an approved pause.
   */
  async getCampaignStatus(
    campaignId: string,
  ): Promise<{ status: string; effectiveStatus: string } | null> {
    try {
      const response = await this.get(`/${campaignId}?fields=status,effective_status`);
      return {
        status: String(response.status ?? ""),
        effectiveStatus: String(response.effective_status ?? ""),
      };
    } catch {
      return null;
    }
  }
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter @switchboard/ad-optimizer test -- meta-ads-client
git add packages/ad-optimizer/src/meta-ads-client.ts packages/ad-optimizer/src/meta-ads-client.test.ts
git commit -m "feat(ad-optimizer): read-only campaign status fetch for the pause executor pre-read"
```

### Task 1.6: The hardened pause execution workflow (the executor)

**Files:**
- Create: `apps/api/src/services/workflows/riley-pause-execution-workflow.ts`
- Create: `apps/api/src/services/workflows/__tests__/riley-pause-execution-workflow.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/services/workflows/__tests__/riley-pause-execution-workflow.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  buildRileyPauseExecutionWorkflow,
  RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS,
} from "../riley-pause-execution-workflow.js";
import type { WorkUnit, WorkflowRuntimeServices } from "@switchboard/core/platform";

const services = {} as WorkflowRuntimeServices; // executor never submits child work

const NOW = new Date("2026-06-06T12:00:00.000Z");

function workUnit(overrides?: {
  parameters?: Record<string, unknown>;
  requestedAt?: string;
  organizationId?: string;
}): WorkUnit {
  return {
    id: "wu_pause_1",
    requestedAt: overrides?.requestedAt ?? "2026-06-06T11:00:00.000Z", // 1h old
    organizationId: overrides?.organizationId ?? "org_1",
    actor: { id: "system", type: "system" },
    intent: "adoptimizer.campaign.pause",
    parameters: overrides?.parameters ?? {
      recommendationId: "rec_1",
      actionType: "pause",
      campaignId: "camp_1",
      rationale: "spend with zero booked revenue",
      evidence: { clicks: 100, conversions: 10, days: 7 },
    },
    deployment: {
      deploymentId: "dep_riley",
      skillSlug: "ad-optimizer",
      trustLevel: "supervised",
      trustScore: 0,
    },
    resolvedMode: "workflow",
    traceId: "trace_1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function harness(overrides?: {
  creds?: { accessToken: string; accountId: string } | null | "org_mismatch";
  campaignStatus?: { status: string; effectiveStatus: string } | null;
  updateCampaignStatus?: ReturnType<typeof vi.fn>;
}) {
  const updateCampaignStatus =
    overrides?.updateCampaignStatus ?? vi.fn().mockResolvedValue(undefined);
  const getCampaignStatus = vi
    .fn()
    .mockResolvedValue(
      overrides?.campaignStatus === undefined
        ? { status: "ACTIVE", effectiveStatus: "ACTIVE" }
        : overrides.campaignStatus,
    );
  const deps = {
    getDeploymentCredentials: vi.fn(
      async (organizationId: string, _deploymentId: string) => {
        if (overrides?.creds === "org_mismatch") {
          return { kind: "org_mismatch" as const };
        }
        if (overrides?.creds === null) return { kind: "none" as const };
        void organizationId;
        return {
          kind: "ok" as const,
          credentials: overrides?.creds ?? { accessToken: "tok", accountId: "act_1" },
        };
      },
    ),
    createAdsClient: vi.fn().mockReturnValue({ updateCampaignStatus, getCampaignStatus }),
    now: () => NOW,
  };
  return { deps, updateCampaignStatus, getCampaignStatus };
}

describe("riley pause execution workflow", () => {
  it("pauses the campaign on Meta and records execution truth + seam declarations", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(h.updateCampaignStatus).toHaveBeenCalledTimes(1);
    expect(h.updateCampaignStatus).toHaveBeenCalledWith("camp_1", "PAUSED");
    expect(result.outputs).toMatchObject({
      paused: true,
      campaignId: "camp_1",
      recommendationId: "rec_1",
      previousStatus: "ACTIVE",
      newStatus: "PAUSED",
      metaWriteAccepted: true,
      requestedAt: "2026-06-06T11:00:00.000Z",
      ageHours: 1,
    });
    expect((result.outputs as { rollbackPlan: string }).rollbackPlan).toMatch(/Resume the campaign/);
    expect(typeof (result.outputs as { successMetric: string }).successMetric).toBe("string");
    expect(Array.isArray((result.outputs as { guardrailMetrics: string[] }).guardrailMetrics)).toBe(true);
  });

  it("fails closed on invalid parameters (no Meta call)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(
      workUnit({ parameters: { recommendationId: "rec_1" } }),
      services,
    );
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("INVALID_PAUSE_INPUT");
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("abstains below the execution floor (completed no-op, never a phantom pause)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(
      workUnit({
        parameters: {
          recommendationId: "rec_1",
          actionType: "pause",
          campaignId: "camp_1",
          rationale: "thin evidence",
          evidence: { clicks: 50, conversions: 5, days: 7 },
        },
      }),
      services,
    );
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: false, skipped: true, reason: "below_execution_floor" });
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not pause when the approval is stale (requestedAt older than the cap)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const staleAt = new Date(
      NOW.getTime() - (RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS + 1) * 60 * 60 * 1000,
    ).toISOString();
    const result = await handler.execute(workUnit({ requestedAt: staleAt }), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: false,
      skipped: true,
      reason: "stale_approval",
      requestedAt: staleAt,
    });
    expect((result.outputs as { ageHours: number }).ageHours).toBeGreaterThan(
      RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS,
    );
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("executes at just under the age cap (boundary)", async () => {
    const h = harness();
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const freshEnough = new Date(
      NOW.getTime() - (RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS - 1) * 60 * 60 * 1000,
    ).toISOString();
    const result = await handler.execute(workUnit({ requestedAt: freshEnough }), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: true });
  });

  it("fails LOUDLY when the deployment belongs to another org (security signal, not a skip)", async () => {
    const h = harness({ creds: "org_mismatch" });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("DEPLOYMENT_ORG_MISMATCH");
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not pause when the campaign is already paused (records previousStatus)", async () => {
    const h = harness({ campaignStatus: { status: "PAUSED", effectiveStatus: "PAUSED" } });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({
      paused: false,
      skipped: true,
      reason: "campaign_already_paused",
      previousStatus: "PAUSED",
    });
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("does not pause a deleted/archived campaign (not pausable)", async () => {
    const h = harness({ campaignStatus: { status: "DELETED", effectiveStatus: "DELETED" } });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: false, skipped: true, reason: "campaign_not_pausable" });
    expect(h.updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("proceeds with previousStatus unknown when the status read degrades (the write is the honest test)", async () => {
    const h = harness({ campaignStatus: null });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ paused: true, previousStatus: "unknown" });
    expect(h.updateCampaignStatus).toHaveBeenCalledTimes(1);
  });

  it("fails honestly when the org has no meta-ads connection", async () => {
    const h = harness({ creds: null });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("NO_META_CONNECTION");
  });

  it("fails honestly when the Meta write throws (drives recovery_required upstream)", async () => {
    const h = harness({
      updateCampaignStatus: vi.fn().mockRejectedValue(new Error("Meta API error (500): boom")),
    });
    const handler = buildRileyPauseExecutionWorkflow(h.deps);
    const result = await handler.execute(workUnit(), services);
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe("META_PAUSE_FAILED");
    expect(result.error?.message).toContain("boom");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter api test -- riley-pause-execution-workflow
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/services/workflows/riley-pause-execution-workflow.ts
import type { WorkflowHandler } from "@switchboard/core/platform";
import { RileyPauseExecutionInput } from "@switchboard/schemas";
import {
  PHASE_C_EXECUTION_SEAM,
  isPhaseCActionClassEligible,
  meetsRileyPauseExecutionFloor,
} from "@switchboard/ad-optimizer";

/**
 * Stale-approval cap: the executor refuses to act on evidence older than this,
 * measured from the work unit's requestedAt (submit time) to execution time.
 * Backstop BEHIND the platform's 24h lifecycle park expiry
 * (platform-ingress.ts createGatedLifecycle); pause-specific and enforced at
 * the last mile regardless of which respond path dispatched.
 */
export const RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS = 48;

/** Org-isolation-aware credential resolution result. */
export type RileyPauseCredsResult =
  | { kind: "ok"; credentials: { accessToken: string; accountId: string } }
  | { kind: "none" }
  | { kind: "org_mismatch" };

export interface RileyPauseExecutionDeps {
  /**
   * Resolve the org's meta-ads connection credentials by deployment id, WITH the
   * org-isolation check inside (the closure verifies the deployment row's
   * organizationId equals the caller's BEFORE decrypting; "org_mismatch" is a
   * loud security failure, never a quiet skip). Defense in depth: the top-level
   * resolver is org-scoped by construction, this guards future resolver changes
   * and hand-edited traces.
   */
  getDeploymentCredentials: (
    organizationId: string,
    deploymentId: string,
  ) => Promise<RileyPauseCredsResult>;
  /**
   * Client factory (MetaAdsClient in production; fakes in tests). Called TWICE
   * per execution on purpose: the client's in-instance 60s rate limiter would
   * otherwise hold the human's approval request open for a minute between the
   * status pre-read and the write. Two Graph calls per human approval is far
   * under any real limit.
   */
  createAdsClient: (creds: { accessToken: string; accountId: string }) => {
    updateCampaignStatus(campaignId: string, status: "PAUSED"): Promise<void>;
    getCampaignStatus(
      campaignId: string,
    ): Promise<{ status: string; effectiveStatus: string } | null>;
  };
  /** Injectable clock for the stale-approval cap. */
  now?: () => Date;
}

/**
 * PHASE-C executor for `adoptimizer.campaign.pause`. Runs ONLY after the seeded
 * require_approval(mandatory) policy parked the submit and a human approved it
 * (respondToParkedLifecycle -> runDispatch -> executeApproved -> WorkflowMode).
 *
 * Execution-truth hardening sequence (design rev 2):
 *   1. Zod parse (fail closed INVALID_PAUSE_INPUT).
 *   2. Class eligibility + raised execution floor (defense in depth; abstain =
 *      deliberate completed no-op, never a phantom pause).
 *   3. Stale-approval cap on requestedAt (48h backstop behind the platform's
 *      24h park expiry). requestedAt + ageHours always recorded.
 *   4. Org-isolation credential resolution (DEPLOYMENT_ORG_MISMATCH is loud).
 *   5. Campaign-status pre-read: already paused / deleted / archived abstains
 *      with the reason + previousStatus; a degraded read proceeds (the write is
 *      the honest test).
 *   6. The pause write via the EXISTING MetaAdsClient.updateCampaignStatus
 *      (which can never set ACTIVE: rollback stays human, recorded not executed).
 *      Failure -> outcome "failed" -> recovery_required + operator Retry card.
 *   7. Outputs record execution truth (previousStatus/newStatus/
 *      metaWriteAccepted/ageHours) + the seam's rollback/success/guardrail
 *      declarations (recorded, not auto-monitored; the slice-3
 *      outcome-attribution cron is the monitoring loop).
 */
export function buildRileyPauseExecutionWorkflow(deps: RileyPauseExecutionDeps): WorkflowHandler {
  const now = deps.now ?? (() => new Date());
  return {
    async execute(workUnit) {
      const parsed = RileyPauseExecutionInput.safeParse(workUnit.parameters);
      if (!parsed.success) {
        return {
          outcome: "failed",
          summary: "Riley pause payload is invalid",
          error: { code: "INVALID_PAUSE_INPUT", message: parsed.error.message },
        };
      }
      const input = parsed.data;

      if (!isPhaseCActionClassEligible("pause")) {
        return {
          outcome: "completed",
          summary: "Abstained from pause (action class is not Phase-C eligible)",
          outputs: { paused: false, skipped: true, reason: "class_ineligible" },
        };
      }
      if (!meetsRileyPauseExecutionFloor(input.evidence)) {
        return {
          outcome: "completed",
          summary: "Abstained from pause (below the execution evidence floor)",
          outputs: { paused: false, skipped: true, reason: "below_execution_floor" },
        };
      }

      const requestedAt = workUnit.requestedAt;
      const ageHours = (now().getTime() - new Date(requestedAt).getTime()) / (60 * 60 * 1000);
      if (ageHours > RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS) {
        return {
          outcome: "completed",
          summary: `Abstained from pause (approval is stale: ${Math.round(ageHours)}h old, cap ${RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS}h)`,
          outputs: {
            paused: false,
            skipped: true,
            reason: "stale_approval",
            requestedAt,
            ageHours: Math.round(ageHours * 100) / 100,
          },
        };
      }

      const deploymentId = workUnit.deployment.deploymentId;
      const credsResult = await deps.getDeploymentCredentials(
        workUnit.organizationId,
        deploymentId,
      );
      if (credsResult.kind === "org_mismatch") {
        return {
          outcome: "failed",
          summary: "Deployment does not belong to the work unit's organization",
          error: {
            code: "DEPLOYMENT_ORG_MISMATCH",
            message: `Deployment ${deploymentId} is not owned by organization ${workUnit.organizationId}; refusing to use its credentials.`,
          },
        };
      }
      if (credsResult.kind === "none") {
        return {
          outcome: "failed",
          summary: "No usable meta-ads connection for the Riley deployment",
          error: {
            code: "NO_META_CONNECTION",
            message: `Deployment ${deploymentId} has no decryptable meta-ads connection.`,
          },
        };
      }
      const creds = credsResult.credentials;

      // Pre-read on a FRESH client (see createAdsClient doc comment).
      const statusRead = await deps.createAdsClient(creds).getCampaignStatus(input.campaignId);
      const previousStatus = statusRead?.status ?? "unknown";
      if (statusRead?.status === "PAUSED") {
        return {
          outcome: "completed",
          summary: `Campaign ${input.campaignId} is already paused; nothing to do`,
          outputs: {
            paused: false,
            skipped: true,
            reason: "campaign_already_paused",
            previousStatus,
            requestedAt,
            ageHours: Math.round(ageHours * 100) / 100,
          },
        };
      }
      if (statusRead && (statusRead.status === "DELETED" || statusRead.status === "ARCHIVED")) {
        return {
          outcome: "completed",
          summary: `Campaign ${input.campaignId} is ${statusRead.status.toLowerCase()}; not pausable`,
          outputs: {
            paused: false,
            skipped: true,
            reason: "campaign_not_pausable",
            previousStatus,
            requestedAt,
            ageHours: Math.round(ageHours * 100) / 100,
          },
        };
      }

      try {
        await deps.createAdsClient(creds).updateCampaignStatus(input.campaignId, "PAUSED");
      } catch (err) {
        return {
          outcome: "failed",
          summary: `Meta pause failed for campaign ${input.campaignId}`,
          error: {
            code: "META_PAUSE_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }

      const seam = PHASE_C_EXECUTION_SEAM.pause!;
      return {
        outcome: "completed",
        summary: `Paused campaign ${input.campaignId} on Meta (Riley self-execution, human-approved)`,
        outputs: {
          paused: true,
          campaignId: input.campaignId,
          recommendationId: input.recommendationId,
          previousStatus,
          newStatus: "PAUSED",
          metaWriteAccepted: true,
          requestedAt,
          ageHours: Math.round(ageHours * 100) / 100,
          rollbackPlan: seam.rollbackPlan,
          successMetric: seam.successMetric,
          guardrailMetrics: seam.guardrailMetrics,
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter api test -- riley-pause-execution-workflow
```

Expected: PASS (all 11).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/workflows/riley-pause-execution-workflow.ts apps/api/src/services/workflows/__tests__/riley-pause-execution-workflow.test.ts
git commit -m "feat(api): hardened riley pause executor (stale cap, org isolation, status pre-read)"
```

### Task 1.7: Register the intent + handler in bootstrap

**Files:**
- Modify: `apps/api/src/bootstrap/contained-workflows.ts`

- [ ] **Step 1: Wire the handler**

Four edits, mirroring the handoff registration exactly:

1. Dynamic import block (next to the other workflow imports, ~line 137):

```ts
  const { buildRileyPauseExecutionWorkflow } =
    await import("../services/workflows/riley-pause-execution-workflow.js");
  const { RILEY_PAUSE_INTENT } = await import("../services/workflows/riley-pause-submit-request.js");
```

2. Handler construction (next to `recommendationHandoffWorkflow`, ~line 210). Credential resolution mirrors `apps/api/src/bootstrap/inngest.ts:365-373` (PrismaDeploymentConnectionStore + decryptCredentials) PLUS the org-isolation compare; MetaAdsClient comes from ad-optimizer. Verify exact import names against `@switchboard/db`'s barrel (the inngest bootstrap imports them statically; copy those names) and how to read a deployment row's organizationId (`PrismaDeploymentStore.findById` per Step 0.3):

```ts
  // Phase-C pause executor: on approval, pauses the campaign on Meta with the
  // org's own meta-ads credentials. Org isolation INSIDE the resolver closure:
  // the deployment row's organizationId must equal the work unit's before any
  // credential decrypts (defense in depth behind the org-scoped resolver).
  const { PrismaDeploymentConnectionStore, PrismaDeploymentStore, decryptCredentials } =
    await import("@switchboard/db");
  const { MetaAdsClient } = await import("@switchboard/ad-optimizer");
  const pauseConnectionStore = new PrismaDeploymentConnectionStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentConnectionStore>[0],
  );
  const pauseDeploymentStore = new PrismaDeploymentStore(
    prismaClient as ConstructorParameters<typeof PrismaDeploymentStore>[0],
  );
  const rileyPauseExecutionWorkflow = buildRileyPauseExecutionWorkflow({
    getDeploymentCredentials: async (organizationId, deploymentId) => {
      const deployment = await pauseDeploymentStore.findById(deploymentId);
      if (!deployment || deployment.organizationId !== organizationId) {
        return { kind: "org_mismatch" as const };
      }
      const connections = await pauseConnectionStore.listByDeployment(deploymentId);
      const conn = connections.find((c) => c.type === "meta-ads");
      if (!conn) return { kind: "none" as const };
      const creds = decryptCredentials(conn.credentials);
      return {
        kind: "ok" as const,
        credentials: {
          accessToken: creds.accessToken as string,
          accountId: creds.accountId as string,
        },
      };
    },
    createAdsClient: (creds) => new MetaAdsClient(creds),
  });
```

(If `findById` returns null for a MISSING deployment, that maps to "org_mismatch" here, which is the safe direction: a vanished deployment must not pause anything. Keep that conflation and note it in the closure comment.)

3. Handlers map entry (~line 308):

```ts
    [RILEY_PAUSE_INTENT, rileyPauseExecutionWorkflow],
```

4. Registration entry in `workflowIntents` (next to the handoff entry, same commentary discipline):

```ts
    {
      // Phase-C pause self-execution (Riley v3 slice-5 seam, wired). A
      // Riley-initiated (system) ad mutation: deliberately NOT
      // system_auto_approved - the seeded require_approval(mandatory) policy
      // (db seed riley-pause-governance.ts) parks it for a human, and
      // "mandatory" survives the autonomous-deployment spend lever.
      // approvalPolicy here is decorative (the policy engine reads
      // policyApprovalOverride). parameterSchema stays {} because the field is
      // decorative platform-wide (zero non-test consumers); real containment is
      // the typed builder + internal-only trigger + the executor's fail-closed
      // Zod parse. Internal-trigger-only (not reachable from the public API).
      intent: RILEY_PAUSE_INTENT,
      workflowId: RILEY_PAUSE_INTENT,
      budgetClass: "cheap",
      approvalPolicy: "always",
      allowedTriggers: ["internal"],
    },
```

(The `workflowIntents` array literal is typed; `RILEY_PAUSE_INTENT` is a const string import, which is fine. If the array's type annotation requires literal strings, use the literal `"adoptimizer.campaign.pause"` with a comment pointing at RILEY_PAUSE_INTENT, and add a test asserting they match.)

- [ ] **Step 2: Build + run the api suite**

```bash
pnpm --filter api build && pnpm --filter api test
```

Expected: green. The ingress-boundary test must not flag anything (no new route).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bootstrap/contained-workflows.ts
git commit -m "feat(api): register adoptimizer.campaign.pause workflow intent + executor"
```

### Task 1.8: Real-gate test (the keystone safety test)

**Files:**
- Create: `apps/api/src/__tests__/riley-pause-gate.test.ts`

Mirror `apps/api/src/__tests__/recommendation-handoff-gate.test.ts` (REAL GovernanceGate + policy engine, no spy ingress). Read it in the worktree and replicate `systemSpec()` and the `gateDeps` assembly verbatim; build the pause policies from the db builders.

- [ ] **Step 1: Write the test**

```ts
// apps/api/src/__tests__/riley-pause-gate.test.ts
/**
 * adoptimizer.campaign.pause, exercised through the REAL GovernanceGate + policy
 * engine (NOT a spy ingress). Proves the Phase-C pause gate AND its decomposition:
 *
 *   - allow + approval policies + seeded system principal -> parks at MANDATORY,
 *   - allow ALONE -> executes (documents the approval policy is load-bearing;
 *     never seed one without the other),
 *   - approval ALONE -> default-DENY (the allow is what un-denies),
 *   - un-seeded org -> default-DENY (fail safe),
 *   - the AUTONOMOUS trustLevelOverride does NOT relax the mandatory park,
 *   - the anchored pause rule does NOT bleed onto other intents.
 *
 * Mirrors recommendation-handoff-gate.test.ts (the proven real-gate harness).
 */
import { describe, it, expect } from "vitest";
import { GovernanceGate, type GovernanceGateDeps } from "@switchboard/core/platform";
import type { WorkUnit, IntentRegistration } from "@switchboard/core/platform";
import { evaluate, resolveIdentity } from "@switchboard/core";
import type { IdentitySpec, Policy } from "@switchboard/schemas";
import {
  RILEY_PAUSE_ALLOW_POLICY_RULE,
  buildRileyPauseAllowPolicyInput,
  buildRileyPauseApprovalPolicyInput,
} from "@switchboard/db";
import { RILEY_PAUSE_INTENT } from "../services/workflows/riley-pause-submit-request.js";

// systemSpec() + gateDeps(policies): replicate from recommendation-handoff-gate.test.ts
// (same IdentitySpec fixture, same GovernanceGateDeps over the real evaluate +
// resolveIdentity). allowPolicy()/approvalPolicy() build Policy rows from the db
// builders the production seed uses (id/name/rule/effect/approvalRequirement/
// priority/organizationId), adding the Policy-row fields the engine type needs
// (cartridgeId: null, createdAt/updatedAt fixtures).

function pauseWorkUnit(opts?: { trustLevelOverride?: "autonomous" }): WorkUnit {
  return {
    id: "wu-pause-1",
    requestedAt: "2026-06-06T00:00:00.000Z",
    organizationId: ORG,
    actor: { id: "system", type: "system" },
    intent: RILEY_PAUSE_INTENT,
    parameters: {
      recommendationId: "rec_1",
      actionType: "pause",
      campaignId: "camp_1",
      rationale: "sustained spend with zero booked revenue",
      evidence: { clicks: 100, conversions: 10, days: 7 },
    },
    deployment: {
      deploymentId: "dep-riley",
      skillSlug: "ad-optimizer",
      trustLevel: "guided",
      trustScore: 0,
      ...(opts?.trustLevelOverride ? { trustLevelOverride: opts.trustLevelOverride } : {}),
    },
    resolvedMode: "workflow",
    traceId: "trace-pause-1",
    trigger: "internal",
    priority: "normal",
  } as WorkUnit;
}

function pauseRegistration(): IntentRegistration {
  return {
    intent: RILEY_PAUSE_INTENT,
    defaultMode: "workflow",
    allowedModes: ["workflow"],
    executor: { mode: "workflow", workflowId: RILEY_PAUSE_INTENT },
    parameterSchema: {},
    mutationClass: "write",
    budgetClass: "cheap",
    approvalPolicy: "always",
    idempotent: false,
    allowedTriggers: ["internal"],
    timeoutMs: 300_000,
    retryable: true,
  };
}

describe("riley pause governance gate (real engine)", () => {
  it("parks at MANDATORY with the seeded policies + seeded system principal", async () => {
    const gate = new GovernanceGate(gateDeps([allowPolicy(), approvalPolicy()]));
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("require_approval");
    expect(decision.approvalLevel).toBe("mandatory");
  });

  it("the AUTONOMOUS trust override does NOT relax the mandatory park", async () => {
    const gate = new GovernanceGate(gateDeps([allowPolicy(), approvalPolicy()]));
    const decision = await gate.evaluate(
      pauseWorkUnit({ trustLevelOverride: "autonomous" }),
      pauseRegistration(),
    );
    expect(decision.outcome).toBe("require_approval");
    expect(decision.approvalLevel).toBe("mandatory");
  });

  it("DECOMPOSITION: allow alone EXECUTES (the approval policy is load-bearing)", async () => {
    const gate = new GovernanceGate(gateDeps([allowPolicy()]));
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("execute");
  });

  it("DECOMPOSITION: approval alone default-DENIES (the allow is what un-denies)", async () => {
    const gate = new GovernanceGate(gateDeps([approvalPolicy()]));
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("an un-seeded org default-DENIES (fail safe)", async () => {
    const gate = new GovernanceGate(gateDeps([]));
    const decision = await gate.evaluate(pauseWorkUnit(), pauseRegistration());
    expect(decision.outcome).toBe("deny");
  });

  it("the anchored rule does not bleed onto the handoff intent", () => {
    const re = new RegExp(RILEY_PAUSE_ALLOW_POLICY_RULE.conditions[0]!.value);
    expect(re.test("adoptimizer.recommendation.handoff")).toBe(false);
    expect(re.test("adoptimizer.campaign.pause")).toBe(true);
  });
});
```

NOTE on the decomposition legs: if `approval alone` does NOT default-deny in the real engine (e.g. the require_approval policy's own match also sets `policyDecision = "allow"`, per `policy-engine.ts:327-331`), then the real behavior is "approval alone = parks at mandatory". That is SAFER than deny. Pin whichever the real engine does, with a comment explaining the observed semantics; do not force the expectation. The load-bearing assertions are: both-policies = mandatory park, allow-alone = execute (the dangerous config, documented), unseeded = deny.

- [ ] **Step 2: Run the test**

```bash
pnpm --filter api test -- riley-pause-gate
```

Expected: PASS. The autonomous-override leg is load-bearing: if it fails, STOP and re-read `spend-approval-threshold.ts` and the workUnit deployment field name; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/riley-pause-gate.test.ts
git commit -m "test(api): real-engine gate proof for riley pause (mandatory park, autonomous-immune, policy decomposition)"
```

### Task 1.9: Approve-to-dispatch loop test (park -> approve -> Meta paused; failure -> recovery)

**Files:**
- Create: `apps/api/src/__tests__/riley-pause-lifecycle-world.ts`
- Create: `apps/api/src/__tests__/riley-pause-approval-loop.test.ts`

Mirror `recommendation-handoff-approval-loop.test.ts` + `recommendation-handoff-lifecycle-world.ts`. Read both in the worktree first. The pause world differs in three ways: (a) the registered intent/handler is the pause executor over a FAKE Meta client (records calls; one-shot failure switch), (b) the submit is a direct `platformIngress.submit(buildRileyPauseSubmitRequest(...))` (PR-1 has no cron initiator; the hand-built submit stands in for PR-2), (c) assertions check the fake Meta client + trace outputs instead of CreativeJob rows.

World-file handler construction:

```ts
const metaCalls: Array<{ campaignId: string; status: string }> = [];
let breakOnce = false;
const pauseHandler = buildRileyPauseExecutionWorkflow({
  getDeploymentCredentials: async (organizationId, _deploymentId) =>
    organizationId === ORG
      ? { kind: "ok" as const, credentials: { accessToken: "tok", accountId: "act_1" } }
      : { kind: "org_mismatch" as const },
  createAdsClient: () => ({
    getCampaignStatus: async () => ({ status: "ACTIVE", effectiveStatus: "ACTIVE" }),
    updateCampaignStatus: async (campaignId: string, status: "PAUSED") => {
      if (breakOnce) {
        breakOnce = false;
        throw new Error("Meta API error (500): transient");
      }
      metaCalls.push({ campaignId, status });
    },
  }),
});
```

registered for `RILEY_PAUSE_INTENT` (workflow mode, `allowedTriggers: ["internal"]`), with the seeded pause policies (from the db builders) + the seeded `system` IdentitySpec, exactly as the handoff world seeds its counterparts. Expose `metaCalls` and `breakMetaOnce()` on the world's harness.

- [ ] **Step 1: Write the test**

```ts
import { buildRileyPauseSubmitRequest } from "../services/workflows/riley-pause-submit-request.js";

const submitInput = {
  organizationId: ORG,
  recommendationId: "rec_1",
  campaignId: "camp_1",
  rationale: "sustained spend with zero booked revenue",
  evidence: { clicks: 1000, conversions: 100, days: 30 },
};
const dep = { deploymentId: "dep_riley", skillSlug: "ad-optimizer" };

it("NEVER auto-executes: the submit parks and Meta is untouched before a human approves", async () => {
  const w = buildPauseLifecycleWorld();
  const res = await w.harness.ingress.submit(buildRileyPauseSubmitRequest(submitInput, dep)!);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error("submit failed");
  // The phantom-success gotcha, pinned: the response MUST carry approvalRequired.
  expect("approvalRequired" in res && res.approvalRequired).toBe(true);
  expect(res.result.outcome).toBe("pending_approval");
  expect(w.harness.metaCalls).toHaveLength(0);
});

it("park -> approve -> the executor pauses on Meta; trace + lifecycle + dispatch truthful", async () => {
  const w = buildPauseLifecycleWorld();
  const res = await w.harness.ingress.submit(buildRileyPauseSubmitRequest(submitInput, dep)!);
  if (!res.ok || !("approvalRequired" in res)) throw new Error("did not park");
  const { lifecycleId, bindingHash } = res as { lifecycleId: string; bindingHash: string };

  const result = await respondToParkedLifecycle(w.deps, {
    lifecycleId,
    action: "approve",
    respondedBy: "operator_jane",
    bindingHash,
  });
  expect(result.approvalState.status).toBe("approved");
  expect(result.executionResult?.success).toBe(true);
  expect(w.harness.metaCalls).toEqual([{ campaignId: "camp_1", status: "PAUSED" }]);

  const lifecycle = await w.lifecycleService.getLifecycleById(lifecycleId);
  const trace = (await w.harness.traceStore.getByWorkUnitId(lifecycle!.actionEnvelopeId))!.trace;
  expect(trace.outcome).toBe("completed");
  expect(trace.executionOutputs).toMatchObject({
    paused: true,
    campaignId: "camp_1",
    previousStatus: "ACTIVE",
    newStatus: "PAUSED",
    metaWriteAccepted: true,
  });
  expect((trace.executionOutputs as { rollbackPlan: string }).rollbackPlan).toMatch(/Resume the campaign/);
});

it("a REAL reject pauses nothing and fails the trace", async () => {
  // mirror the handoff reject leg; expect(w.harness.metaCalls).toHaveLength(0)
});

it("a failed Meta write parks a Retry card (recovery_required); retrying recovers", async () => {
  const w = buildPauseLifecycleWorld();
  w.harness.breakMetaOnce();
  // submit -> approve: executionResult.success === false, lifecycle status
  // "recovery_required", metaCalls empty; approve again through the SAME respond
  // leg: success === true, metaCalls has the PAUSED call. (Exact mirror of the
  // handoff failure leg, asserting Meta instead of jobs.)
});

it("duplicate submit with the same idempotency key returns the prior park (no double lifecycle)", async () => {
  const w = buildPauseLifecycleWorld();
  const req = buildRileyPauseSubmitRequest(submitInput, dep)!;
  await w.harness.ingress.submit(req);
  const second = await w.harness.ingress.submit(req);
  expect(second.ok).toBe(true);
  if (second.ok) expect(second.result.outcome).toBe("pending_approval"); // cached claim, not a second park
});

it("a stale park cannot execute (platform expiry OR executor cap, whichever fires first)", async () => {
  // Per Step 0.3 finding: if respondToParkedLifecycle enforces lifecycle
  // expiresAt, drive time past it and assert the respond leg refuses. If it
  // does not, drive time past RILEY_PAUSE_MAX_APPROVAL_AGE_HOURS (executor cap;
  // inject `now` into the world's pause handler) and assert approve yields the
  // stale_approval no-op with metaCalls empty. Pin the REAL behavior; comment
  // which layer fired.
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter api test -- riley-pause-approval-loop
```

Expected: PASS, all six legs.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/__tests__/riley-pause-approval-loop.test.ts apps/api/src/__tests__/riley-pause-lifecycle-world.ts
git commit -m "test(api): pause approve-to-dispatch loop (never-auto-execute, approve, recovery, idempotency, staleness)"
```

### Task 1.10: Parked-approval card copy

**Files:**
- Modify: `apps/api/src/services/workflows/parked-approval-cards.ts` (`summarizeParkedIntent`)
- Modify: its co-located test (find it: `grep -rn "summarizeParkedIntent" apps/api/src --include="*.test.ts"`)

- [ ] **Step 1: Read the module, add the pause case test-first**

The handoff renders "Riley wants to brief Mira..."; add a pause case so the Inbox/Slack card is humanized. Test expectation (adapt to the module's actual signature):

```ts
it("summarizes a parked riley pause", () => {
  const s = summarizeParkedIntent("adoptimizer.campaign.pause", {
    recommendationId: "rec_1",
    actionType: "pause",
    campaignId: "camp_1",
    rationale: "sustained spend with zero booked revenue",
    evidence: { clicks: 1000, conversions: 100, days: 30 },
  });
  expect(s.humanSummary).toContain("camp_1");
  expect(s.humanSummary).toMatch(/Riley wants to pause/);
  expect(s.primaryLabel).toBe("Approve pause");
});
```

Implementation: one new case mirroring the handoff case's structure, summary text
`Riley wants to pause campaign ${campaignId}: ${rationale}` with primary label "Approve pause". Match the module's existing return shape exactly.

- [ ] **Step 2: Run, verify pass, commit**

```bash
pnpm --filter api test -- parked-approval-cards
git add apps/api/src/services/workflows/parked-approval-cards.ts apps/api/src/services/workflows/__tests__/parked-approval-cards.test.ts
git commit -m "feat(api): humanized approval card for the parked riley pause"
```

(Adjust the test path to wherever the existing test actually lives.)

### Task 1.11: PR-1 gauntlet + ship

- [ ] **Step 1: Full verification**

```bash
pnpm build && pnpm test && pnpm typecheck && pnpm format:check && pnpm arch:check && pnpm lint
```

Expected: all green. Known flakes (rerun before investigating): chat gateway-bridge-attribution under parallel turbo load, pg_advisory_xact_lock db-integrity tests.

- [ ] **Step 2: Proof greps for the PR body (incl. the intent-string typo guard)**

```bash
git diff origin/main...HEAD --stat
git grep -n "PlatformIngress" packages/ad-optimizer/src | wc -l   # MUST be 0
grep -rn "adoptim" --include="*.ts" packages apps | grep -v "adoptimizer" | wc -l   # MUST be 0 (typo guard)
git grep -rn "adoptimizer.campaign.pause" --include="*.ts" | grep -v test | grep -v riley-pause   # only bootstrap + seed expected
git grep -rn "buildRileyPauseSubmitRequest" apps/api/src --include="*.ts" | grep -v test | grep -v riley-pause-submit-request   # MUST be empty (no initiator yet)
```

- [ ] **Step 3: Push + PR**

```bash
git branch --show-current   # feat/riley-phase-c-pause-wiring
git push -u origin feat/riley-phase-c-pause-wiring
gh pr create --title "feat(api,ad-optimizer,db,schemas): riley phase-c pause wiring pr-1 dark spine" --body "<summary + proofs + test evidence>"
```

PR body must include: the proof greps, why mandatory survives autonomous (file:line), the Step 0.3 expiry/org-scoping findings, the parameterSchema-is-decorative note, the no-initiator statement, and the design/plan doc paths.

- [ ] **Step 4: superpowers:requesting-code-review, fix findings in-branch, merge on green (squash), keep the worktree (PR-2 continues here on a stacked branch)**

```bash
git checkout -b feat/riley-phase-c-pause-initiator   # PR-2 branch stacked on PR-1
```

(If PR-1's review forces changes after PR-2 starts: never `--delete-branch` mid-stack; after PR-1 squash-merges, `git rebase --onto origin/main feat/riley-phase-c-pause-wiring feat/riley-phase-c-pause-initiator`.)

---

## PR-2: Initiator (flag-gated submit-and-park from the weekly audit)

Branch: `feat/riley-phase-c-pause-initiator` (stacked on PR-1; retarget to main after PR-1 merges). PR title: `feat(api,ad-optimizer): riley pause initiator, flag-gated submit-and-park from the weekly audit`.

### Task 2.1: Pure dispatch module (Layer 2, park-truth submitter contract)

**Files:**
- Create: `packages/ad-optimizer/src/riley-pause-dispatch.ts`
- Create: `packages/ad-optimizer/src/riley-pause-dispatch.test.ts`
- Modify: `packages/ad-optimizer/src/index.ts` (export the submitter type + builder)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/ad-optimizer/src/riley-pause-dispatch.test.ts
import { describe, it, expect } from "vitest";
import { buildRileyPauseCandidate } from "./riley-pause-dispatch.js";

const emitted = {
  recommendationId: "rec_1",
  actionType: "pause" as const,
  campaignId: "camp_1",
  rationale: "sustained spend with zero booked revenue",
  surface: "queue" as const, // use a REAL non-dropped RecommendationSurface value (check schemas; the sink counts "shadow_action" and "dropped" distinctly, mirror its fixtures)
};
const context = {
  evidence: { clicks: 1000, conversions: 100, days: 30 },
  learningPhaseActive: false,
};
const base = {
  emitted,
  index: 2,
  primaryPauseIndex: 2,
  context,
  organizationId: "org_1",
  deploymentId: "dep_1",
};

describe("buildRileyPauseCandidate (primary-only, eligibility, floor)", () => {
  it("builds a candidate for the primary pause with strong evidence", () => {
    expect(buildRileyPauseCandidate(base)).toEqual({
      organizationId: "org_1",
      deploymentId: "dep_1",
      recommendationId: "rec_1",
      campaignId: "camp_1",
      rationale: "sustained spend with zero booked revenue",
      evidence: context.evidence,
    });
  });

  it("returns null for a non-pause action even at the primary index", () => {
    expect(
      buildRileyPauseCandidate({ ...base, emitted: { ...emitted, actionType: "scale" } }),
    ).toBeNull();
  });

  it("returns null when not the arbitration primary (primary-only is structural)", () => {
    expect(buildRileyPauseCandidate({ ...base, primaryPauseIndex: 0 })).toBeNull();
    expect(buildRileyPauseCandidate({ ...base, primaryPauseIndex: undefined })).toBeNull();
  });

  it("returns null for a dropped recommendation", () => {
    expect(
      buildRileyPauseCandidate({ ...base, emitted: { ...emitted, surface: "dropped" } }),
    ).toBeNull();
  });

  it("returns null without a captured campaign context", () => {
    expect(buildRileyPauseCandidate({ ...base, context: undefined })).toBeNull();
  });

  it("returns null below the execution floor", () => {
    expect(
      buildRileyPauseCandidate({
        ...base,
        context: { ...context, evidence: { clicks: 99, conversions: 9, days: 7 } },
      }),
    ).toBeNull();
  });

  it("returns null with an empty deploymentId (no targetHint provenance, no submit)", () => {
    expect(buildRileyPauseCandidate({ ...base, deploymentId: "" })).toBeNull();
  });
});
```

(The wrong-campaign-context case is structural here: the caller passes `context` already keyed by the rec's campaignId; the sink test in Task 2.2 covers the map-miss path.)

- [ ] **Step 2: Run to verify fail, then implement**

```ts
// packages/ad-optimizer/src/riley-pause-dispatch.ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  RecommendationSurface,
} from "@switchboard/schemas";
import type { Evidence } from "./evidence-floor.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";
import { isPhaseCActionClassEligible } from "./action-contract.js";
import { meetsRileyPauseExecutionFloor } from "./riley-pause-execution-floor.js";

/**
 * PHASE-C pause dispatch (the initiator's Layer-2 half). Mirrors
 * recommendation-handoff-dispatch.ts: pure candidate decision here, injected
 * submitter callback wired by apps/api (this package never imports
 * PlatformIngress).
 *
 * PRIMARY-ONLY is structural: a candidate exists only at the arbitration
 * primary's index (parent spec section 3: self-execution honors the single
 * mutating primary; non-primary mutating candidates never self-submit).
 */
export interface RileyPauseCandidate {
  organizationId: string;
  /** Riley's own active per-org ad-optimizer deployment id (targetHint provenance). */
  deploymentId: string;
  recommendationId: string;
  campaignId: string;
  rationale: string;
  evidence: Evidence;
}

/**
 * Bootstrap-injected submit sink (apps/api). Returns PARK TRUTH: parked=true
 * only when the submit actually parked for approval (the approvalRequired
 * branch). Strict-truth riley_self ownership (PR-3) reads this; never report
 * Riley ownership of work that did not park. Best-effort: implementations never
 * throw into the audit.
 */
export type RileyPauseSubmitter = (
  candidate: RileyPauseCandidate,
) => Promise<{ parked: boolean }>;

export function buildRileyPauseCandidate(args: {
  emitted: {
    recommendationId: string;
    actionType: AdRecommendationAction;
    campaignId: string;
    rationale: string;
    surface: RecommendationSurface;
  };
  /** This recommendation's index in the final candidate set (entry identity). */
  index: number;
  /** The arbitration primary's index IF the primary is a pause; undefined otherwise. */
  primaryPauseIndex: number | undefined;
  context: HandoffCampaignContext | undefined;
  organizationId: string;
  deploymentId: string;
}): RileyPauseCandidate | null {
  const { emitted, index, primaryPauseIndex, context, organizationId, deploymentId } = args;
  if (emitted.actionType !== "pause") return null;
  if (primaryPauseIndex === undefined || index !== primaryPauseIndex) return null;
  if (emitted.surface === "dropped") return null;
  if (!context) return null;
  if (!deploymentId) return null;
  // Class eligibility consumed VERBATIM (never re-derived) + the raised floor.
  if (!isPhaseCActionClassEligible("pause")) return null;
  if (!meetsRileyPauseExecutionFloor(context.evidence)) return null;
  return {
    organizationId,
    deploymentId,
    recommendationId: emitted.recommendationId,
    campaignId: emitted.campaignId,
    rationale: emitted.rationale,
    evidence: context.evidence,
  };
}
```

Barrel (`packages/ad-optimizer/src/index.ts`):

```ts
// Phase-C pause initiator seam: candidate decision is package-internal; only the
// submitter type + builder cross the boundary (apps/api wires the callback).
export { buildRileyPauseCandidate } from "./riley-pause-dispatch.js";
export type { RileyPauseCandidate, RileyPauseSubmitter } from "./riley-pause-dispatch.js";
```

- [ ] **Step 3: Run tests, commit**

```bash
pnpm --filter @switchboard/ad-optimizer test -- riley-pause-dispatch
git add packages/ad-optimizer/src/riley-pause-dispatch.ts packages/ad-optimizer/src/riley-pause-dispatch.test.ts packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): primary-only riley pause candidate builder + park-truth submitter seam"
```

### Task 2.2: Thread the dispatch through the sink (park truth out; evidence-map rename)

**Files:**
- Modify: `packages/ad-optimizer/src/recommendation-sink.ts`
- Modify: its test file (find with `grep -rln "recommendationHandoffSubmitter" packages/ad-optimizer/src --include="*.test.ts"`)

- [ ] **Step 1: Write the failing tests** (in the sink's existing test file, mirroring its handoff-dispatch style: fake emitter returning `{id, surface}`, spy submitters)

```ts
it("dispatches the pause submitter ONLY for the arbitration-primary pause and records park truth", async () => {
  const rileyPauseSubmitter = vi
    .fn<(c: RileyPauseCandidate) => Promise<{ parked: boolean }>>()
    .mockResolvedValue({ parked: true });
  const result = await runRecommendationSink({
    ...baseArgs,
    recommendations: [pauseRec("camp_a"), pauseRec("camp_b")],
    rileyPauseSubmitter,
    pausePrimaryIndex: 1,
    campaignEvidenceByCampaign: new Map([
      ["camp_a", strongContext],
      ["camp_b", strongContext],
    ]),
  });
  expect(rileyPauseSubmitter).toHaveBeenCalledTimes(1);
  expect(rileyPauseSubmitter.mock.calls[0]![0].campaignId).toBe("camp_b");
  expect(result.pauseParkedIndex).toBe(1);
});

it("pauseParkedIndex stays undefined when the submitter reports not-parked", async () => {
  // .mockResolvedValue({ parked: false }) -> result.pauseParkedIndex undefined
});

it("no dispatch and no park index when: submitter absent / no primary / rec not persisted (no result.id) / context map misses the campaign", async () => {
  // four sub-cases, each: zero submitter calls (where applicable) and
  // result.pauseParkedIndex === undefined. For the no-id case, the fake emitter
  // returns { surface: "queue" } without an id for the primary rec.
});

it("a throwing pause submitter is safe (sink completes; park index undefined)", async () => {
  // .mockRejectedValue(new Error("boom")) -> no throw out of the sink.
});
```

Also mechanical: this task renames the sink arg `handoffContextByCampaign` to `campaignEvidenceByCampaign` (it now feeds handoff + pause dispatch; the TYPE `HandoffCampaignContext` keeps its name). Update the handoff tests' arg name in the same sweep.

- [ ] **Step 2: Implement.** In `runRecommendationSink` args interface:

```ts
  /** Per-campaign evidence + learning context (captured by the runner's
   * per-campaign loop). Feeds the handoff abstention AND the pause dispatch.
   * (Renamed from handoffContextByCampaign when the pause initiator landed;
   * the HandoffCampaignContext TYPE name is unchanged.) */
  campaignEvidenceByCampaign?: Map<string, HandoffCampaignContext>;
  /** Phase-C pause initiator (apps/api-injected). Absent = no pause self-submission. */
  rileyPauseSubmitter?: RileyPauseSubmitter;
  /** The arbitration primary's index WHEN that primary is a pause; undefined otherwise. */
  pausePrimaryIndex?: number;
```

Result type gains:

```ts
  /** Index (entry identity) of the recommendation whose pause submit ACTUALLY
   * parked this run; undefined when nothing parked. Strict-truth riley_self
   * ownership reads this. */
  pauseParkedIndex?: number;
```

Loop becomes indexed (`for (const [index, rec] of args.recommendations.entries())`); after the handoff dispatch block:

```ts
    // Phase-C pause self-submission: route the arbitration-PRIMARY pause (and only
    // it) to the governed pause intent. Gated on a persisted id, the captured
    // context, class eligibility + the raised execution floor (in
    // buildRileyPauseCandidate). Best-effort: a pause submit failure never breaks
    // emission/routing; the ingress idempotency key backstops a retry double-submit.
    // The submitter's park truth feeds strict-truth riley_self ownership.
    if (args.rileyPauseSubmitter && result.id) {
      const pauseCandidate = buildRileyPauseCandidate({
        emitted: {
          recommendationId: result.id,
          actionType: rec.action,
          campaignId: rec.campaignId,
          rationale: humanizeRecommendation(rec),
          surface: result.surface,
        },
        index,
        primaryPauseIndex: args.pausePrimaryIndex,
        context: args.campaignEvidenceByCampaign?.get(rec.campaignId),
        organizationId: args.orgId,
        deploymentId: args.emissionContext.deploymentId ?? "",
      });
      if (pauseCandidate) {
        try {
          const outcome = await args.rileyPauseSubmitter(pauseCandidate);
          if (outcome.parked) pauseParkedIndex = index;
        } catch (err) {
          console.warn(
            `[ad-optimizer] Riley pause submit threw for rec=${pauseCandidate.recommendationId}: ${String(err)}`,
          );
        }
      }
    }
```

with `let pauseParkedIndex: number | undefined;` declared beside the counters and `...(pauseParkedIndex !== undefined ? { pauseParkedIndex } : {})` in the return.

- [ ] **Step 3: Run sink tests, commit**

```bash
pnpm --filter @switchboard/ad-optimizer test -- recommendation-sink
git add packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/recommendation-sink.test.ts
git commit -m "feat(ad-optimizer): sink dispatches the primary pause and returns park truth"
```

### Task 2.3: Thread through the audit runner

**Files:**
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (deps interface ~line 194, constructor ~line 278, sink call ~line 645; local `handoffContextByCampaign` renames to `campaignEvidenceByCampaign`)
- Modify: the runner's handoff/sink test (find: `grep -rln "recommendationHandoffSubmitter" packages/ad-optimizer/src/__tests__`)

- [ ] **Step 1: Failing test** (mirror the existing audit-runner handoff test): drive `runner.run()` with a fixture producing one strong pause rec; assert the pause submitter received the candidate whose recommendationId matches the arbitration primary; assert a fixture whose primary is NOT a pause yields zero pause dispatches; assert the submitter is invoked even when the HANDOFF submitter is absent (the context map must flow for the pause alone).

- [ ] **Step 2: Implement.**

1. `AuditDependencies` gains:

```ts
  /** Phase-C pause initiator (apps/api-injected; capability = permission: the
   * cron passes it ONLY for orgs with the per-deployment flag ON). */
  rileyPauseSubmitter?: RileyPauseSubmitter;
```

2. Constructor stores it (mirror `recommendationHandoffSubmitter` lines).
3. Hoist the primary-pause computation above the sink call and pass through:

```ts
    const pausePrimaryIndex =
      arbitration?.primary && arbitration.primary.action === "pause"
        ? arbitration.primary.index
        : undefined;
```

and at the sink call:

```ts
        rileyPauseSubmitter: this.rileyPauseSubmitter,
        pausePrimaryIndex,
        campaignEvidenceByCampaign:
          this.recommendationHandoffSubmitter || this.rileyPauseSubmitter
            ? campaignEvidenceByCampaign
            : undefined,
```

4. Capture the sink result's `pauseParkedIndex` into a local (`const sinkResult = await runRecommendationSink(...)` already exists) and stash it on a runner-scoped variable for PR-3's ownership step. In PR-2 it is only logged with the existing rollup `console.warn` (add `pauseParked=${sinkResult.pauseParkedIndex ?? "none"}`).

- [ ] **Step 3: Run the runner suite + the EVAL suite**

```bash
pnpm --filter @switchboard/ad-optimizer test
pnpm eval:riley   # 12+10 golden + 6 arbitration MUST be byte-identical
```

- [ ] **Step 4: Commit**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/__tests__/
git commit -m "feat(ad-optimizer): audit runner threads the pause submitter + primary index into the sink"
```

### Task 2.4: Cron deps + per-deployment flag (Layer 2 contract)

**Files:**
- Modify: `packages/ad-optimizer/src/inngest-functions.ts` (DeploymentInfo + CronDependencies + executeWeeklyAudit)
- Modify: its test (find the executeWeeklyAudit test file)

- [ ] **Step 1: Failing test:** executeWeeklyAudit with `rileyPauseSubmitter` in deps + a deployment whose `pauseSelfExecutionEnabled` is true threads the submitter into the runner; flag false/absent does NOT (follow the existing test's pattern for asserting handoff-submitter threading).

- [ ] **Step 2: Implement.**

1. `DeploymentInfo` gains `pauseSelfExecutionEnabled?: boolean`.
2. `CronDependencies` gains:

```ts
  /** Phase-C pause initiator. Wired by apps/api ONLY under the env kill switch;
   * threaded into each org's AuditRunner ONLY when that deployment's
   * governanceSettings.pauseSelfExecutionEnabled === true (capability-passing as
   * enforcement; both default OFF). Absent = the weekly audit self-submits no pauses. */
  rileyPauseSubmitter?: RileyPauseSubmitter;
```

3. In `executeWeeklyAudit`'s per-deployment runner construction (next to the `recommendationHandoffSubmitter` spread, ~line 249):

```ts
        ...(deps.rileyPauseSubmitter && deployment.pauseSelfExecutionEnabled
          ? { rileyPauseSubmitter: deps.rileyPauseSubmitter }
          : {}),
```

- [ ] **Step 3: Run, commit**

```bash
pnpm --filter @switchboard/ad-optimizer test
git add packages/ad-optimizer/src/inngest-functions.ts packages/ad-optimizer/src/__tests__/
git commit -m "feat(ad-optimizer): weekly audit threads the pause submitter only for flag-on deployments"
```

### Task 2.5: apps/api wiring (closure + flag read + env switch)

**Files:**
- Modify: `apps/api/src/bootstrap/contained-workflows.ts` (add `submitRileyPause` to the bootstrap result, next to `submitRecommendationHandoff`)
- Modify: `apps/api/src/bootstrap/inngest.ts` (candidate adapter closure + flag mapping + env switch; thread the new option through whichever server bootstrap passes `submitRecommendationHandoff` today: `grep -rn "submitRecommendationHandoff" apps/api/src --include="*.ts" | grep -v test`)
- Modify: `scripts/env-allowlist.local-readiness.json` + `.env.example`

- [ ] **Step 1: contained-workflows.ts** (mirror `submitRecommendationHandoff`):

```ts
  /**
   * Top-level submit closure for the Phase-C pause initiator. Builds the canonical
   * request (or returns null when Riley abstains: class/floor legs in the builder)
   * and submits through PlatformIngress with the resolved Riley deployment as the
   * targetHint, parking for mandatory human approval via the seeded policy. No
   * parentWorkUnitId - cron-initiated work units are legitimate trace roots.
   */
  submitRileyPause: (
    input: RileyPauseSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ) => Promise<SubmitWorkResponse | null>;
```

```ts
  const submitRileyPause = async (
    input: RileyPauseSubmitInput,
    deployment: { deploymentId: string; skillSlug: string },
  ): Promise<SubmitWorkResponse | null> => {
    const req = buildRileyPauseSubmitRequest(input, deployment);
    if (!req) return null;
    return platformIngress.submit(req);
  };
```

(plus the import of `buildRileyPauseSubmitRequest, type RileyPauseSubmitInput` and adding `submitRileyPause` to the returned object.)

- [ ] **Step 2: inngest.ts.** Three edits:

1. `listActiveDeployments` mapping gains the flag (verify the store returns `governanceSettings`; if it projects fields, extend the projection in `packages/db` + its test):

```ts
      return deployments.map((d) => ({
        id: d.id,
        organizationId: d.organizationId,
        inputConfig: (d.inputConfig as Record<string, unknown>) ?? {},
        pauseSelfExecutionEnabled:
          ((d.governanceSettings as Record<string, unknown> | null)?.[
            "pauseSelfExecutionEnabled"
          ] ?? false) === true,
      }));
```

2. The submitter closure (next to `recommendationHandoffSubmitter`; park truth out, every branch loud):

```ts
  // Phase-C pause initiator. The cron (via the audit-runner sink) calls this for
  // the arbitration-primary pause of a flag-on org. Submits through PlatformIngress,
  // parking for mandatory approval. Returns PARK TRUTH for strict-truth ownership.
  // Best-effort: failures are caught and logged; the weekly audit never breaks.
  const rileyPauseSubmitter: RileyPauseSubmitter = async (candidate) => {
    if (!options.submitRileyPause) return { parked: false };
    try {
      const res = await options.submitRileyPause(
        {
          organizationId: candidate.organizationId,
          recommendationId: candidate.recommendationId,
          campaignId: candidate.campaignId,
          rationale: candidate.rationale,
          evidence: candidate.evidence,
        },
        { deploymentId: candidate.deploymentId, skillSlug: "ad-optimizer" },
      );
      if (res === null) return { parked: false }; // builder abstained (class/floor)
      if (!res.ok) {
        if (res.error.type === "entitlement_required") {
          // NAMED skip: an unentitled org is an honest, visible skip, never a
          // silent no-op that reads as "Riley chose not to act".
          app.log.warn(
            `[inngest] riley pause skip:org_not_entitled org=${candidate.organizationId} rec=${candidate.recommendationId}`,
          );
          return { parked: false };
        }
        app.log.error(
          `[inngest] riley pause submit error type=${res.error.type} rec=${candidate.recommendationId}: ${res.error.message}`,
        );
        return { parked: false };
      }
      // Phantom-success gotcha: branch on approvalRequired membership BEFORE
      // reading the result as a success.
      if ("approvalRequired" in res && res.approvalRequired) {
        app.log.info(
          `[inngest] riley pause parked for approval rec=${candidate.recommendationId} lifecycle=${res.lifecycleId ?? "?"}`,
        );
        return { parked: true };
      }
      if (res.result.outcome === "failed") {
        // ok:true + outcome failed = governance DENY. Visible, loud.
        app.log.error(
          `[inngest] riley pause submit denied/failed rec=${candidate.recommendationId}: ${res.result.error?.code ?? "unknown"}`,
        );
        return { parked: false };
      }
      // Mandatory policy means park-or-deny; reaching here means the gate relaxed.
      app.log.error(
        `[inngest] riley pause UNEXPECTEDLY executed without approval rec=${candidate.recommendationId} outcome=${res.result.outcome} - investigate governance seeding`,
      );
      return { parked: false };
    } catch (err) {
      app.log.warn(
        `[inngest] riley pause submit threw for rec=${candidate.recommendationId}: ${String(err)}`,
      );
      return { parked: false };
    }
  };
```

3. Wire into `adOptimizerDeps` under the env kill switch:

```ts
    // Kill switch: RILEY_PAUSE_SELF_EXECUTION_ENABLED=true wires the initiator;
    // default absent = the deploy is dark (per-org flags then gate per deployment).
    ...(process.env["RILEY_PAUSE_SELF_EXECUTION_ENABLED"] === "true"
      ? { rileyPauseSubmitter }
      : {}),
```

- [ ] **Step 3: env allowlist + example**

`scripts/env-allowlist.local-readiness.json`: add `"RILEY_PAUSE_SELF_EXECUTION_ENABLED"` to `required_in_env_example`. `.env.example`:

```
# Phase-C: Riley pause self-submission initiator (cron-level kill switch; per-org
# governanceSettings.pauseSelfExecutionEnabled must ALSO be true). Default off.
RILEY_PAUSE_SELF_EXECUTION_ENABLED=false
```

- [ ] **Step 4: Build + api tests, commit**

```bash
pnpm --filter api build && pnpm --filter api test
git add apps/api/src/bootstrap/contained-workflows.ts apps/api/src/bootstrap/inngest.ts scripts/env-allowlist.local-readiness.json .env.example
git commit -m "feat(api): flag-gated riley pause submitter wired into the weekly audit cron"
```

### Task 2.6: Auditable flag toggle script

**Files:**
- Create: `scripts/riley-pause-flag.ts`
- Test: `scripts/__tests__/riley-pause-flag.test.ts` IF the scripts dir has a test convention; otherwise co-locate the pure helper in `packages/db/src/seed/riley-pause-flag-toggle.ts` + test there and keep the script a thin CLI over it (PREFERRED: db-package helper + thin script, so the logic is tested in CI).

The flag is capability assignment; flipping it must be auditable. The helper:

```ts
// packages/db/src/seed/riley-pause-flag-toggle.ts
import type { PrismaClient } from "@prisma/client";
import { AD_OPTIMIZER_LISTING_SLUG } from "./seed-riley-ad-optimizer-deployment.js";

/**
 * Auditable per-org toggle for Phase-C pause self-execution
 * (governanceSettings.pauseSelfExecutionEnabled on the org's Riley deployment).
 * Writes an AuditLedger row (actor, org, old -> new) so capability changes are
 * never silent DB mutations. ROLLOUT RULE: do not enable for any production org
 * until ownership strict-truth (PR-3) is merged and verified.
 */
export async function setRileyPauseSelfExecution(
  prisma: PrismaClient,
  args: { organizationId: string; enabled: boolean; actor: string },
): Promise<{ previous: boolean; current: boolean }> {
  const listing = await prisma.agentListing.findUnique({
    where: { slug: AD_OPTIMIZER_LISTING_SLUG },
    select: { id: true },
  });
  if (!listing) throw new Error("ad-optimizer listing not found; run seedMarketplace first");
  const deployment = await prisma.agentDeployment.findUnique({
    where: {
      organizationId_listingId: { organizationId: args.organizationId, listingId: listing.id },
    },
    select: { id: true, governanceSettings: true },
  });
  if (!deployment) {
    throw new Error(`no riley deployment for org ${args.organizationId}; seed it first`);
  }
  const settings = (deployment.governanceSettings as Record<string, unknown> | null) ?? {};
  const previous = settings["pauseSelfExecutionEnabled"] === true;
  await prisma.agentDeployment.update({
    where: { id: deployment.id },
    data: {
      governanceSettings: { ...settings, pauseSelfExecutionEnabled: args.enabled },
    },
  });
  await prisma.auditLedgerEntry.create({
    data: {
      eventType: "governance.capability.changed",
      actorType: "user",
      actorId: args.actor,
      entityType: "deployment",
      entityId: deployment.id,
      organizationId: args.organizationId,
      riskCategory: "high",
      summary: `pauseSelfExecutionEnabled: ${previous} -> ${args.enabled} (by ${args.actor})`,
      snapshot: { previous, current: args.enabled, flag: "pauseSelfExecutionEnabled" },
    },
  });
  return { previous, current: args.enabled };
}
```

(VERIFY the AuditLedger Prisma model + field names in `packages/db/prisma/schema.prisma` before writing; mirror an existing `auditLedger`-writing seed/store call. If ledger writes go through a store class rather than raw prisma, use that store. If the model name differs, adapt; the REQUIREMENT is one immutable audit row per toggle.)

Test (mocked prisma): flips false->true and true->false, writes the audit row with old/new, throws on missing deployment, never touches other governanceSettings keys.

The thin CLI:

```ts
// scripts/riley-pause-flag.ts
// Usage: npx tsx scripts/riley-pause-flag.ts <orgId> --enable|--disable --actor <who>
import { PrismaClient } from "@prisma/client";
import { setRileyPauseSelfExecution } from "@switchboard/db";

const [orgId, mode, actorFlag, actor] = process.argv.slice(2);
if (!orgId || !["--enable", "--disable"].includes(mode ?? "") || actorFlag !== "--actor" || !actor) {
  console.error("usage: npx tsx scripts/riley-pause-flag.ts <orgId> --enable|--disable --actor <who>");
  process.exit(1);
}
const prisma = new PrismaClient();
const result = await setRileyPauseSelfExecution(prisma, {
  organizationId: orgId,
  enabled: mode === "--enable",
  actor,
});
console.warn(
  `[riley-pause-flag] org=${orgId} pauseSelfExecutionEnabled ${result.previous} -> ${result.current} (audit row written)`,
);
await prisma.$disconnect();
```

Export the helper from `packages/db/src/index.ts`.

- [ ] Run db tests, commit:

```bash
pnpm --filter @switchboard/db test -- riley-pause-flag
git add packages/db/src/seed/riley-pause-flag-toggle.ts packages/db/src/seed/riley-pause-flag-toggle.test.ts packages/db/src/index.ts scripts/riley-pause-flag.ts
git commit -m "feat(db): auditable per-org toggle for riley pause self-execution"
```

### Task 2.7: Cron full-loop test (the producer-population proof)

**Files:**
- Create: `apps/api/src/__tests__/riley-pause-cron-loop.test.ts` (mirror `recommendation-handoff-cron-full-loop.test.ts` + the PR-1 pause world)

- [ ] **Step 1: Write the test.** Five legs:

1. **Default posture pinned:** deployment WITHOUT `pauseSelfExecutionEnabled` (the real seeded default) + submitter wired -> `executeWeeklyAudit` produces a strong primary pause -> ZERO pause submits, handoff path untouched.
2. **Flag ON end-to-end:** deployment with `pauseSelfExecutionEnabled: true` -> the audit parks exactly one pause lifecycle (assert `approvalRequired`, `result.outcome === "pending_approval"`, idempotency key `mutate:riley:<recId>:pause`, submitter returned `{parked: true}`) -> `respondToParkedLifecycle` approve -> fake Meta client received `(campaignId, "PAUSED")`.
3. **Primary-only:** fixture with primary = a non-pause mutating action + a secondary pause -> zero pause submits even with flag ON.
4. **Entitlement skip:** entitlement resolver stub returns unentitled -> submit returns `entitlement_required` -> the cron logs the named skip, returns `{parked: false}`, and the audit completes (no throw).
5. **No persisted id:** emitter yields no `result.id` for the primary pause -> no dispatch.

Drive through `executeWeeklyAudit(step, deps)` with deps built like `buildCronDeps` in `recommendation-handoff-harness.ts` (the strong-evidence fixture needs `inlineLinkClicks >= 100`, `conversions >= 10` on the current-window insight so the EXECUTION floor passes).

- [ ] **Step 2: Run, commit**

```bash
pnpm --filter api test -- riley-pause-cron-loop
git add apps/api/src/__tests__/riley-pause-cron-loop.test.ts
git commit -m "test(api): pause cron loop (flag-off default, flag-on park-approve-pause, primary-only, entitlement skip)"
```

### Task 2.8: PR-2 gauntlet + ship

- [ ] Same gauntlet as Task 1.11 (build/test/typecheck/format/arch/lint + eval:riley + the typo grep). Extra proofs for the PR body:

```bash
git grep -n "PlatformIngress" packages/ad-optimizer/src | wc -l   # STILL 0
git grep -rn "RILEY_PAUSE_SELF_EXECUTION_ENABLED" --include="*.ts" --include="*.json"   # inngest.ts + allowlist only
```

- [ ] Push, PR (retarget to main after PR-1 merges; never `--delete-branch` mid-stack), code-review, fix in-branch, squash-merge on green.

```bash
git checkout -b feat/riley-phase-c-ownership-riley-self   # PR-3 branch
```

---

## PR-3: Ownership honesty (riley_self, STRICT TRUTH)

Branch: `feat/riley-phase-c-ownership-riley-self`. PR title: `feat(ad-optimizer,schemas): strict-truth riley_self ownership on the report wire`.

`riley_self` is emitted ONLY for the recommendation whose pause submit ACTUALLY PARKED this run (the sink's `pauseParkedIndex`). Flag off, env off, denied, entitlement-skipped, abstained, or park failed: the report says `operator_approval`. The report never claims Riley ownership of an action Riley did not take.

### Task 3.1: Widen the wire

**Files:**
- Modify: `packages/schemas/src/ad-optimizer.ts` (lines ~44-61)
- Modify: the options-equality test (find: `grep -rln "EmittableOwnershipClassSchema" --include="*.test.ts" packages/`)

- [ ] **Step 1: Failing test first:** update the options-equality test to assert the two enums are now IDENTICAL (the Phase-C widening event #923 reserved), and add a parse test: a report `ownership` entry with `ownership: "riley_self"` parses.

- [ ] **Step 2: Implement:**

```ts
// EmittableOwnershipClassSchema: what the derivation can produce AND the report
// wire accepts. Phase-C (pause wiring session) widened it to include riley_self
// under STRICT TRUTH: the runner emits it only for a recommendation whose pause
// submit actually parked this run (sink pauseParkedIndex), never from
// gate-eligibility alone. The two enums are now identical; both names stay
// exported (consumers reference each).
export const EmittableOwnershipClassSchema = z.enum([
  "operator_swipe",
  "operator_approval",
  "mira_handoff",
  "human_escalation",
  "riley_self",
]);
```

with `OwnershipClassSchema` keeping its derived form (no duplicate riley_self).

- [ ] **Step 3: Run schemas + dependent suites, commit**

```bash
pnpm --filter @switchboard/schemas test && pnpm build && pnpm --filter @switchboard/ad-optimizer test
git add packages/schemas/src/ad-optimizer.ts packages/schemas/src/__tests__/
git commit -m "feat(schemas): report wire accepts riley_self ownership (phase-c widening)"
```

### Task 3.2: Strict-truth ownership annotation (post-sink)

**Files:**
- Modify: `packages/ad-optimizer/src/recommendation-ownership.ts`
- Modify: its test file
- Modify: `packages/ad-optimizer/src/audit-runner.ts` (move the 8e annotation below Step 9; feed `pauseParkedIndex`)

- [ ] **Step 1: Failing tests:**

```ts
it("riley_self for exactly the recommendation whose pause submit parked", () => {
  const out = deriveOwnershipAnnotations({
    recommendations: [pauseRec("camp_1"), creativeRec("camp_2")],
    handoffContextByCampaign: ctx,
    pauseParkedIndex: 0,
  });
  expect(out[0]!.ownership).toBe("riley_self");
  expect(out[1]!.ownership).not.toBe("riley_self");
});

it("no park, no riley_self: undefined parked index leaves output byte-identical to pre-PR-3", () => {
  const recs = [pauseRec("camp_1"), creativeRec("camp_2")];
  expect(
    deriveOwnershipAnnotations({ recommendations: recs, handoffContextByCampaign: ctx }),
  ).toEqual(
    deriveOwnershipAnnotations({
      recommendations: recs,
      handoffContextByCampaign: ctx,
      pauseParkedIndex: undefined,
    }),
  );
});
```

(Use the ownership test file's existing fixtures/param names; if `deriveOwnershipAnnotations`' map param is renamed in Task 2.2's sweep, match it.)

- [ ] **Step 2: Implement.** `deriveOwnershipAnnotations` gains optional `pauseParkedIndex?: number`; the per-rec mapping short-circuits BEFORE `deriveOwnership`:

```ts
  return args.recommendations.map((r, index) => ({
    campaignId: r.campaignId,
    action: r.action,
    index,
    ownership:
      index === args.pauseParkedIndex
        ? // STRICT TRUTH (Phase-C): this rec's pause submit actually parked this
          // run. Park fact, not gate eligibility: a flag-on-but-failed submit
          // stays operator_approval. Precedence above mira_handoff is moot
          // (pause is not a creative action) but deliberate: a parked
          // self-execution is Riley-owned, the approval ceremony is the gate.
          "riley_self"
        : deriveOwnership({
            action: r.action,
            urgency: r.urgency,
            handoffContext: args.handoffContextByCampaign?.get(r.campaignId),
          }),
  }));
```

(`deriveOwnership` itself is UNCHANGED: the strict-truth discriminator is the park fact, which lives at the annotation layer.)

3. `audit-runner.ts`: move the Step 8e block below the Step 9 sink call; pass `pauseParkedIndex: sinkResult?.pauseParkedIndex` (undefined when no emitter/sink ran). The report assembly at Step 10 is unchanged. Add a comment: annotation reads the park outcome, so it must run post-sink; the report is the only consumer.

- [ ] **Step 3: Run everything**

```bash
pnpm --filter @switchboard/ad-optimizer test && pnpm eval:riley && pnpm --filter dashboard test -- swipe-policy.parity
```

The dashboard parity test pins `canSwipeApprove` over emitted risk contracts: riley_self does not change risk contracts, so it must stay green untouched. If it reds, STOP and investigate; do not patch the parity test.

- [ ] **Step 4: Commit**

```bash
git add packages/ad-optimizer/src/recommendation-ownership.ts packages/ad-optimizer/src/recommendation-ownership.test.ts packages/ad-optimizer/src/audit-runner.ts
git commit -m "feat(ad-optimizer): strict-truth riley_self ownership from the sink's park fact"
```

### Task 3.3: PR-3 gauntlet + ship

- [ ] Full gauntlet (as Task 1.11, incl. the typo grep) + `pnpm eval:riley`. Push, PR, code-review, fix in-branch, squash-merge on green.

---

## Post-merge (after all three PRs)

- [ ] **Teardown the same day:**

```bash
cd /Users/jasonli/switchboard
git worktree remove .claude/worktrees/riley-phase-c-wiring && git worktree prune
```

- [ ] Update memory: `project_riley_v3_control_plane.md` (Phase-C wiring shipped: PR numbers, flag names, the strict-truth ownership decision, what stayed deferred; the ROLLOUT RULE: org flips only via scripts/riley-pause-flag.ts, none before PR-3 verified).
- [ ] CHECK-IN #2 with PR links, shipped/deferred summary.

## Rollout rule (from design review)

**No production org gets `pauseSelfExecutionEnabled` flipped ON until PR-3 is merged and verified.** Until then the env switch may be enabled in an environment only for end-to-end verification with a non-production org. All flips go through `scripts/riley-pause-flag.ts` (audited); no raw DB mutations.

## Known CI flakes (rerun before investigating)

api-auth prod-hardening; pg_advisory_xact_lock (work-trace/ledger/greeting); bootstrap-smoke npm-warn; chat gateway-bridge-attribution under parallel turbo load; Eval Claim Classifier fails on EVERY main push (broken Actions secret, informational).

## Deliberately deferred (report at CHECK-IN #2)

- Auto-rollback / resume intent / guardrail auto-monitoring (declarations recorded in trace outputs only).
- Post-write observed-paused readback (request-accepted truth recorded in v1).
- Second action class; trust-threshold auto-widening; 4d corroborated / 4e late-interval.
- Approval-card rich rendering beyond the humanized summary.
- CBO/shared-budget special-casing (operator judgment at approval).
- Platform-wide ingress parameter-schema enforcement (field verified decorative; separate hardening item).
- `HandoffCampaignContext` TYPE rename (variable rename ships in PR-2).
