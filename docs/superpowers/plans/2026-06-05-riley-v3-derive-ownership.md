# Riley v3: deriveOwnership Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RevenueOpportunity ownership real (spec 2.2 net-new item 1): one pure `deriveOwnership(...)` in `packages/ad-optimizer` that classifies every audit recommendation as `operator_swipe | operator_approval | mira_handoff | human_escalation` (with `riley_self` type-reserved, never emitted), subsuming the dashboard swipe gate, the Mira handoff gate, and the recorded-unavailable governance input, with parity proofs against the LIVE logic and the spec-7.7 placement decision settled as a cross-package parity tripwire.

**Architecture:** A pure classification module (`recommendation-ownership.ts`, Layer 2) whose arms read the LIVE producers directly: the handoff arm calls `shouldAbstainFromHandoff` (the same function the dispatch runs), and the swipe/escalation arms read a newly extracted `emittedRiskContractFor(action, urgency)` helper that the sink ITSELF now calls (one producer for the five emitted risk-contract fields, so emission, ownership, and the tripwire can never fork). The annotation lands report-level beside `arbitration` (the slice-2 additive precedent): optional Zod field, no Prisma model, structurally invisible to the eval harness. The dashboard keeps its generic `canSwipeApprove` gate; a new test-only devDependency lets a dashboard parity test enumerate the full domain and fail CI on any drift between the gate and the derivation (spec 7.7: duplication can no longer be silent).

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/schemas` (Layer 1), `packages/ad-optimizer` (Layer 2), `apps/dashboard` (Layer 5, test-only consumer); Vitest; `pnpm eval:riley` + `pnpm eval:governance` golden harnesses (byte-unchanged gates).

---

## Global invariants (every task)

- Advisory-only: no new `PlatformIngress` caller in `packages/ad-optimizer`; no Meta write; no new mutating caller. Ownership ANNOTATES; it gates nothing.
- Zero behavior change to decisions, arbitration, emission routing, and handoff gating. The two refactors in this slice (sink risk-contract extraction, unconditional runner-internal context map) are value-identical and pinned by existing tests plus eval byte-compare.
- `pnpm eval:riley` AND `pnpm eval:governance` byte-unchanged against the saved baselines (`/tmp/dob-baselines/eval-riley.baseline.txt`, `/tmp/dob-baselines/eval-governance.baseline.txt`, both green at base SHA `7865b68f`). Diff after every behavior-bearing task. NO new eval fixtures in this slice: an added fixture changes the harness output ("Loaded N ..."), and byte-unchanged is the gate. The derivation is pinned by unit sweeps, integration pins, and the cross-package tripwire instead.
- ESM + `.js` relative imports in packages; dashboard imports omit `.js` (relative AND `@/`); no `any`; co-located `*.test.ts`; no em-dashes anywhere; commitlint lowercase subjects, headers <= 100 chars; lint-staged reformats on commit so re-`git add`; files under the 600-line arch ceiling (`audit-runner.ts` carries the legacy `eslint-disable max-lines` marker, warn-tier: this slice adds ~12 lines of glue there and no more).
- Known local suite noise (baselined at `7865b68f`): db trio always red locally (prisma-work-trace-store-integrity 6, prisma-ledger-storage 2, prisma-greeting-signal-store 1); lead-intake-store concurrency can flake under full-suite load; api-auth prod-hardening + chat gateway-bridge-attribution + bootstrap-smoke npm-warn are CI flakes (rerun before investigating); the Eval Claim Classifier job fails every main push (broken Actions secret, informational). `eval:alex-conversation` is env-blocked locally (no `ANTHROPIC_API_KEY` in the shell; graceful skip off main): ship on the static proof chain and say so in the PR.

## Verified live anchors (origin/main @ `7865b68f`, audited 2026-06-05; re-verify if drifted)

- Swipe gate: `apps/dashboard/src/lib/decisions/swipe-policy.ts:8-10` `canSwipeApprove(c) = !!c && c.riskLevel === "low" && !c.externalEffect && !c.financialEffect && !c.clientFacing`; `needsConfirm(c) = !c || c.requiresConfirmation || c.riskLevel === "high"` (`:17-19`). Live callers: `inbox-decision-card.tsx:57` (handoffs hard-excluded first), `decisions/swipe-decision-card.tsx:50-51`, `approval-detail-sheet.tsx:116`, `inbox-drawer.tsx:97`.
- The dashboard `RiskContract` (`apps/dashboard/src/lib/decisions/types.ts:11-17`) mirrors core `Decision.meta.riskContract`, built 1:1 from the persisted Recommendation row in `packages/core/src/decisions/adapters/recommendation-adapter.ts:32-38` (`?? false` defaults).
- Sink emission (`packages/ad-optimizer/src/recommendation-sink.ts`): `URGENCY_TO_RISK` (immediate=high, this_week=medium, next_cycle=low, `:119-123`); per-rec fields at `:419-438`: `financialEffect = contract.financialEffect`, `externalEffect = contract.externalEffect || rec.resetsLearning === "yes"` (the elevation, `:424`), `clientFacing: false` ALWAYS (`:437`; Riley does not message clients), `requiresConfirmation: false` ALWAYS (`:438`).
- Elevated contract: `packages/ad-optimizer/src/action-contract.ts` `ACTION_CONTRACT` (14 actions) + `isMutating = financialEffect || externalEffect || resetsLearning === "yes"` (`:133-136`). Both creative actions (`refresh_creative`, `add_creative`) are static-false/false but `resetsLearning: "yes"`, so they are mutating after elevation and can NEVER pass the swipe gate.
- Handoff gate: `recommendation-handoff-abstention.ts` `CREATIVE_HANDOFF_ACTIONS = {refresh_creative, add_creative}`; `shouldAbstainFromHandoff({actionType, evidence, learningPhaseActive})` checks routability, then `meetsEvidenceFloor`, then learning lock. Evidence floors (`evidence-floor.ts:14-20`): diagnostic (refresh_creative) clicks>=10/conv>=0/days>=3; destructive (add_creative) clicks>=50/conv>=5/days>=7.
- Gate vs dispatch split: `buildHandoffCandidate` (`recommendation-handoff-dispatch.ts:88-115`) additionally requires a non-dropped surface, a captured context, and a deploymentId. Those are DISPATCH mechanics; ownership classifies by the GATE (see Decision D3).
- Runner: `audit-runner.ts:313-315` builds `handoffContextByCampaign` ONLY when a submitter is wired; `:509-512` populates it per campaign via `handoffContextFromInsight` (pure, no Graph call); Step 8d arbitration at `:617-625` is the additive report-annotation precedent; Step 9 sink call at `:634-646` passes the context map. `audit-runner-handoff.test.ts:191` pins `sinkArgs.handoffContextByCampaign === undefined` without a submitter; this pin MUST stand unflipped.
- Report schema: `packages/schemas/src/ad-optimizer.ts:221-313`; `arbitration` (`:286-312`) is the entry-shape precedent `{campaignId, action, index, score}` (index disambiguates: campaignId+action is not unique, e.g. per-breach `fix_signal_health` recs). `AuditReportSchema` is type-only outside schemas (no runtime `.parse` consumer in apps/packages); the report persists as AgentTask JSON output.
- Eval harness: `evals/riley-recommendation/run-eval.ts` is assertion-based (12 decideForCampaign + 10 source-reallocation + 6 arbitration cases), never constructs an AuditRunner, never serializes an AuditReport. A report-level field is structurally invisible to it.
- Governance reality at the emission site: ad-optimizer (Layer 2) cannot import core (Layer 3). The gate verdict is per-request at act/submit time: `operator.act_on_recommendation` evaluates when the OPERATOR acts; the handoff intent `adoptimizer.recommendation.handoff` is parked for mandatory human approval by a SEEDED policy (its registration's `approvalPolicy` is documented "decorative"; the policy engine reads the seeded `policyApprovalOverride`). The app seam (`apps/api/src/bootstrap/inngest.ts:387`) injects no governance verdict into the audit.

## Design decisions (settled in brainstorm; do not re-litigate mid-build)

**D1. Wire placement: report-level sibling annotation.** `ownership` lands beside `arbitration` on `AuditReportSchema` as an optional array, one entry per `recommendations[]` element, same order: `{campaignId, action, index, ownership}`. Rejected alternatives: (a) a field on `RecommendationOutputSchema` (the eval-pinned per-rec shape; ownership needs handoff context that does not exist inside `decideForCampaign`, which runs before the v2/reallocation/signal candidates exist); (b) emission-level persistence through core (that is the read-the-field wire: core types + emit + adapter churn for a slice whose scope fence says ownership annotates and nothing consumes it yet). Eval safety is proved by byte-compare, not asserted: the harness never builds an AuditRunner (anchor above), plus integration pins that abort reports carry no `ownership` key and emission payloads are unchanged.

**D2. The honest input set is `(action, urgency, handoffContext?)`.** Re-derived per spec-signature input:

- `opportunity` -> `action` + `urgency` + `campaignId` (the rec itself).
- `actionContract` -> read in-package (`ACTION_CONTRACT` is total over the 14 actions; the elevated form arrives via `emittedRiskContractFor`).
- `urgency` -> `riskLevel` via the sink's `URGENCY_TO_RISK`, consumed through the same helper the sink emits from.
- `handoffGates` -> `evidence` + `learningPhaseActive` (the captured `HandoffCampaignContext`, the exact struct the live dispatch re-checks). Absent context (account-scoped rec, signal recs, campaign not in this cycle's insight set) fails the handoff arm honestly, mirroring `buildHandoffCandidate` returning null without context.
- `revenueState` -> EXCLUDED, recorded: no live ownership gate reads it. The swipe gate reads four contract fields; the handoff gate reads allowlist + evidence + learning; the escalation tier reads riskLevel. Passing it would be a fabricated dependency (and premature abstraction).
- `governanceMode` -> EXCLUDED as NOT HONESTLY AVAILABLE at the derivation site, recorded: (i) Layer 2 cannot import core; (ii) the gate's verdict is per-request at act/submit time, not a static org property (seeded handoff policy via `policyApprovalOverride`; operator-act evaluation when the operator acts); (iii) the app seam injects no governance verdict into the audit today, and any new injection would be an org-settings snapshot, not the gate's verdict, i.e. a fabricated governance read; (iv) it currently has zero discriminating power: every mutating path from a Riley rec ends in mandatory human approval (seeded handoff policy) or IS the operator acting. Governance mode becomes the live discriminator only in Phase-C, where the permit path's verdict would justify `riley_self`; the input is reserved alongside the enum value it would unlock.
- `clientFacing` -> NOT an input: the sink hardcodes `false` for every Riley rec; pinned by the emission-parity test (Task 2), never assumed.

**D3. Enum semantics and precedence (first match wins): `mira_handoff` -> `operator_swipe` -> `human_escalation` -> `operator_approval`.**

- `mira_handoff`: the LIVE `shouldAbstainFromHandoff` clears (context present and abstain=false). Ownership classifies by the GATE (who should own the fix), not the dispatch (surface/deploymentId mechanics): a router-dropped creative rec is still a creative fix Mira should own; the dispatch separately declines to park un-surfaced work.
- `operator_swipe`: the dashboard's `canSwipeApprove` predicate over `emittedRiskContractFor(action, urgency)`. This one-line predicate is the ONLY restated logic in the slice, and Task 5's tripwire makes that restatement loud (CI-fails on any drift).
- `human_escalation`: the dashboard's `needsConfirm` tier reduced to its reachable arm (`riskLevel === "high"`, i.e. urgency `immediate`; `requiresConfirmation` is constant-false and the contract is always present at this site). Semantics: the live operator surface already splits handling into three tiers (swipe-commit, tap-approve, confirm-gated); ownership mirrors the confirm-gated tier as "demands deliberate, confirmed human attention now".
- `operator_approval`: the default tier.
- Exclusivity is PROVEN, not assumed: handoff-and-swipe is structurally impossible (both creative actions elevate to mutating, sweep-pinned); swipe-and-escalation is impossible (low vs high riskLevel, sweep-pinned). The only real overlap is handoff-and-escalation (an immediate-urgency creative rec clearing the gates): `mira_handoff` wins by live-behavior fidelity (the dispatch hands off regardless of urgency; the abstention reads no urgency; the parked draft IS the governed approval ceremony). Test-pinned with this rationale inline.

**D4. Spec-7.7 settled: parity tripwire, not read-the-field.** The dashboard keeps computing `canSwipeApprove`; a new dashboard test (`swipe-policy.parity.test.ts`, behind a test-only `@switchboard/ad-optimizer` devDependency) enumerates 14 actions x 3 urgencies x context variants and asserts `canSwipeApprove(emittedRiskContractFor(a, u)) === (deriveOwnership(...) === "operator_swipe")` plus the `needsConfirm`/`human_escalation` parity on the operator-owned subset. Why not read-the-field: (i) the swipe gate is generic row infrastructure serving ALL decision kinds (parked-approval conservative defaults, legacy rows where absence is unsafe, handoff cards hard-excluded upstream), so the gate must survive regardless; reading ownership for Riley rows only would SPLIT one honest path into two; (ii) the wire does not exist: ownership would have to travel RecommendationInput -> emit -> row -> decisions adapter -> Decision.meta, core+api churn for a slice whose annotation has no consumer yet; (iii) the slice-2 deferral's own trigger ("revisit when an operator surface consumes arbitration") has not fired. The tripwire makes silent divergence impossible TODAY; read-the-field stays the natural follow-up when an operator surface consumes ownership. The devDependency direction (Layer 5 dev-depends on Layer 2) is legal and build-ordered by turbo (`test` dependsOn `^build`).

**D5. `riley_self` is reserved at three levels.** The schema enum carries it (wire-ready for Phase-C); the derivation's return type is `Exclude<OwnershipClass, "riley_self">` (compile-time unreachable, stronger than a runtime-only floor); a full-domain sweep test pins the annotation builder never emits it (guards future widening). This mirrors and strengthens the 4c `corroborated` type-reserved pattern.

**D6. One producer for the emitted risk contract.** The sink's inline five-field computation extracts into exported `emittedRiskContractFor(action, urgency)`; the sink calls it (value-identical; the elevation now reads the contract's own `resetsLearning`, which every live producer already sets to `resetsLearningFor(action)`, the slice-2-pinned invariant). Emission, ownership, and the tripwire share this single producer, so the elevation can never fork again. Pinned by the existing sink tests, a new all-domain emission-parity test, and eval byte-compare.

**D7. Handoff context decoupled from the submitter, without flipping the pin.** The runner builds `handoffContextByCampaign` UNCONDITIONALLY (runner-internal; one pure `handoffContextFromInsight` call per campaign, no Graph calls), but passes it to the sink ONLY alongside a submitter, exactly as today. The sink-visible contract stays byte-identical and `audit-runner-handoff.test.ts:191` stands unflipped. Ownership reads the always-built map, so the classification is identical whether or not the Mira wire is configured (ownership describes who SHOULD own the fix, not the org's wiring).

## Baselines recorded (base SHA `7865b68f`)

- `pnpm typecheck` green; `pnpm build` green.
- Suites green: schemas, ad-optimizer, core; api 1554 passed / 4 skipped; db red ONLY in the known trio (9 failures: work-trace-integrity 6, ledger 2, greeting 1).
- `eval:riley` 12+10+6 green, saved at `/tmp/dob-baselines/eval-riley.baseline.txt`; `eval:governance` 26 green, saved at `/tmp/dob-baselines/eval-governance.baseline.txt`.
- `eval:alex-conversation` env-blocked (no `ANTHROPIC_API_KEY` in shell; skips gracefully off main).

---

### Task 0: Commit this plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-05-riley-v3-derive-ownership.md` (this file)

- [ ] **Step 0.1:** Commit the plan (the slice-2/4c convention: the plan doc lands in the implementation PR).

```bash
git add docs/superpowers/plans/2026-06-05-riley-v3-derive-ownership.md
git commit -m "docs(plans): riley v3 deriveOwnership implementation plan"
```

---

### Task 1: Schemas: `OwnershipClassSchema` + report-level `ownership` field

**Files:**

- Modify: `packages/schemas/src/ad-optimizer.ts` (enum near the top constants; field after `arbitration`)
- Test: `packages/schemas/src/ad-optimizer.test.ts`

- [ ] **Step 1.1: Write the failing tests.** Append to `packages/schemas/src/ad-optimizer.test.ts` (the existing `baseReport` lives inside the campaignEconomics describe, so this block declares its own local copy). Add `OwnershipClassSchema` to the file's import list from `./ad-optimizer.js`:

```ts
describe("AuditReportSchema ownership (Riley v3, spec 2.2 net-new item 1)", () => {
  const baseReport = {
    accountId: "act-1",
    dateRange: { since: "2026-05-25", until: "2026-06-01" },
    summary: {
      totalSpend: 0,
      totalLeads: 0,
      totalRevenue: 0,
      overallROAS: 0,
      activeCampaigns: 0,
      campaignsInLearning: 0,
      adSetsInLearning: 0,
      adSetsLearningLimited: 0,
    },
    funnel: [],
    periodDeltas: [],
    insights: [],
    watches: [],
    recommendations: [],
  };

  it("parses without ownership (back-compat: pre-ownership reports)", () => {
    expect(AuditReportSchema.parse(baseReport).ownership).toBeUndefined();
  });

  it("parses ownership entries for every emittable class", () => {
    const r = AuditReportSchema.parse({
      ...baseReport,
      ownership: [
        { campaignId: "c1", action: "hold", index: 0, ownership: "operator_swipe" },
        { campaignId: "c1", action: "pause", index: 1, ownership: "human_escalation" },
        { campaignId: "c2", action: "refresh_creative", index: 2, ownership: "mira_handoff" },
        {
          campaignId: "account",
          action: "shift_budget_to_source",
          index: 3,
          ownership: "operator_approval",
        },
      ],
    });
    expect(r.ownership).toHaveLength(4);
    expect(r.ownership?.[2]?.ownership).toBe("mira_handoff");
  });

  it("admits riley_self on the wire (Phase-C reserved; the producer never emits it)", () => {
    // The schema must be wire-ready for Phase-C; the never-emit guarantee lives in
    // the producer (Exclude<> return type + the recommendation-ownership sweep test).
    const r = AuditReportSchema.parse({
      ...baseReport,
      ownership: [{ campaignId: "c1", action: "pause", index: 0, ownership: "riley_self" }],
    });
    expect(r.ownership?.[0]?.ownership).toBe("riley_self");
  });

  it("rejects an unknown ownership class and a negative index", () => {
    expect(() =>
      AuditReportSchema.parse({
        ...baseReport,
        ownership: [{ campaignId: "c1", action: "pause", index: 0, ownership: "operator" }],
      }),
    ).toThrow();
    expect(() =>
      AuditReportSchema.parse({
        ...baseReport,
        ownership: [{ campaignId: "c1", action: "pause", index: -1, ownership: "operator_swipe" }],
      }),
    ).toThrow();
  });

  it("exposes the five-value enum with riley_self reserved last", () => {
    expect(OwnershipClassSchema.options).toEqual([
      "operator_swipe",
      "operator_approval",
      "mira_handoff",
      "human_escalation",
      "riley_self",
    ]);
  });
});
```

Add `OwnershipClassSchema` to the test file's import list from `./ad-optimizer.js`.

- [ ] **Step 1.2: Run to verify failure.**

Run: `pnpm --filter @switchboard/schemas test`
Expected: FAIL (`OwnershipClassSchema` not exported).

- [ ] **Step 1.3: Implement.** In `packages/schemas/src/ad-optimizer.ts`, after the `UrgencySchema` block (`:34-35`), add:

```ts
// Riley v3 (spec 2.2 net-new item 1): who should own the fix for a recommendation.
// riley_self is PHASE-C RESERVED: wire-ready here, but the derivation's return type
// excludes it (Exclude<OwnershipClass, "riley_self">) and a sweep test pins that no
// report annotation ever carries it until Riley earns execution through the
// governed permit path.
export const OwnershipClassSchema = z.enum([
  "operator_swipe",
  "operator_approval",
  "mira_handoff",
  "human_escalation",
  "riley_self",
]);
export type OwnershipClassSchema = z.infer<typeof OwnershipClassSchema>;
```

In `AuditReportSchema`, directly after the `arbitration` field (`:286-312`), add:

```ts
  // Riley v3 (spec 2.2 net-new item 1): per-recommendation ownership annotation,
  // ADDITIVE like arbitration above; it never filters emission or handoff. One
  // entry per recommendations[] element, same order (index = array position; the
  // same disambiguation rule as arbitration: campaignId+action is not unique).
  // campaignId+action are carried for human legibility. riley_self never appears
  // here today (type-reserved; see OwnershipClassSchema).
  ownership: z
    .array(
      z.object({
        campaignId: z.string(),
        action: AdRecommendationActionSchema,
        index: z.number().int().nonnegative(),
        ownership: OwnershipClassSchema,
      }),
    )
    .optional(),
```

- [ ] **Step 1.4: Run to verify pass.**

Run: `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/schemas build && pnpm typecheck`
Expected: PASS (build schemas first so dependents see the new export; typecheck green).

- [ ] **Step 1.5: Commit.**

```bash
git add packages/schemas/src/ad-optimizer.ts packages/schemas/src/ad-optimizer.test.ts
git commit -m "feat(schemas): ownership annotation on the audit report (riley_self type-reserved)"
```

---

### Task 2: Sink: extract `emittedRiskContractFor` (one producer for the five fields)

**Files:**

- Modify: `packages/ad-optimizer/src/recommendation-sink.ts` (`URGENCY_TO_RISK` block + the per-rec field computation at `:419-438`)
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts` (append)

- [ ] **Step 2.1: Write the failing test.** Append to `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts` (the file already imports `AdRecommendationActionSchema` as a value, `runRecommendationSink`, the `baseRec` builder, and a capturing emitter pattern; merge the two new import lines below into the file's existing top-of-file import block, never mid-file):

```ts
import { emittedRiskContractFor } from "../recommendation-sink.js";
import { UrgencySchema } from "@switchboard/schemas";

describe("emittedRiskContractFor (Riley v3 ownership: the single five-field producer)", () => {
  it("matches the sink's emitted risk-contract fields for every action x urgency", async () => {
    for (const action of AdRecommendationActionSchema.options) {
      for (const urgency of UrgencySchema.options) {
        const captured: RecommendationInput[] = [];
        const emit: RecommendationEmitter = async (input) => {
          captured.push(input);
          return { surface: "queue" };
        };
        await runRecommendationSink({
          orgId: "org-1",
          auditRunId: "audit-1",
          recommendations: [baseRec({ action, urgency })],
          emit,
          emissionContext: { cronId: "cron-1" },
        });
        const emitted = captured[0]!;
        const helper = emittedRiskContractFor(action, urgency);
        expect(
          {
            riskLevel: emitted.riskLevel,
            financialEffect: emitted.financialEffect,
            externalEffect: emitted.externalEffect,
            clientFacing: emitted.clientFacing,
            requiresConfirmation: emitted.requiresConfirmation,
          },
          `${action}/${urgency}`,
        ).toEqual(helper);
      }
    }
  });

  it("pins the constants the dashboard gate relies on: clientFacing and requiresConfirmation are always false", () => {
    for (const action of AdRecommendationActionSchema.options) {
      for (const urgency of UrgencySchema.options) {
        const c = emittedRiskContractFor(action, urgency);
        expect(c.clientFacing).toBe(false);
        expect(c.requiresConfirmation).toBe(false);
      }
    }
  });

  it("bakes the learning-reset elevation (both static-false creative actions are externally effecting)", () => {
    expect(emittedRiskContractFor("refresh_creative", "next_cycle").externalEffect).toBe(true);
    expect(emittedRiskContractFor("add_creative", "next_cycle").externalEffect).toBe(true);
    expect(emittedRiskContractFor("hold", "next_cycle").externalEffect).toBe(false);
  });
});
```

(`baseRec` sets `resetsLearning: resetsLearningFor(action)`, which is how every live producer builds recs; the helper reads the contract's own class, the slice-2-pinned single source.)

- [ ] **Step 2.2: Run to verify failure.**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-sink`
Expected: FAIL (`emittedRiskContractFor` not exported).

- [ ] **Step 2.3: Implement.** In `packages/ad-optimizer/src/recommendation-sink.ts`:

(a) After the `URGENCY_TO_RISK` + `URGENCY_TO_EXPIRY_HOURS` constants, add (the INVARIANT comment moves here from the loop):

```ts
/**
 * The five risk-contract fields the sink emits for a Riley recommendation, as ONE
 * exported producer so the sink's emission, the ownership derivation
 * (recommendation-ownership.ts), and the dashboard swipe-policy parity tripwire
 * (apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts) can
 * never disagree about the emitted shape.
 *
 * INVARIANT (Phase-A spec section 5/7): a learning-resetting action is a material,
 * hard-to-undo change even when no dollars move, so externalEffect bakes the
 * elevation (resetsLearning === "yes" forces it true; the router treats
 * externalEffect=true as "not swipe-approvable"). Riley does not message clients
 * (clientFacing always false) and riskLevel drives the UI confirm step
 * (requiresConfirmation always false).
 */
export interface EmittedRiskContract {
  riskLevel: "low" | "medium" | "high";
  financialEffect: boolean;
  externalEffect: boolean;
  clientFacing: boolean;
  requiresConfirmation: boolean;
}

export function emittedRiskContractFor(
  action: RecommendationOutput["action"],
  urgency: RecommendationOutput["urgency"],
): EmittedRiskContract {
  const contract = ACTION_CONTRACT[action];
  return {
    riskLevel: URGENCY_TO_RISK[urgency],
    financialEffect: contract.financialEffect,
    externalEffect: contract.externalEffect || contract.resetsLearning === "yes",
    clientFacing: false,
    requiresConfirmation: false,
  };
}
```

(b) In the emission loop, replace the inline computation (`const contract = ACTION_CONTRACT[rec.action];` through the four literal fields inside the emit input) with:

```ts
const riskContract = emittedRiskContractFor(rec.action, rec.urgency);
```

and in the emit input object replace the five fields with:

```ts
        riskLevel: riskContract.riskLevel,
        financialEffect: riskContract.financialEffect,
        externalEffect: riskContract.externalEffect,
        clientFacing: riskContract.clientFacing,
        requiresConfirmation: riskContract.requiresConfirmation,
```

Note: the elevation source changes from `rec.resetsLearning` to the contract's own class. Every live producer sets `rec.resetsLearning = resetsLearningFor(action)` (slice-2-pinned invariant, `recommendation-engine.ts:82`, `source-reallocation.ts:205`), so this is value-identical on the reachable domain; the action is the single source of truth for the class (the slice-2 consolidation's whole point).

- [ ] **Step 2.4: Run to verify pass + eval byte-compare.**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley > /tmp/dob-baselines/eval-riley.task2.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.task2.txt && echo BYTE-UNCHANGED`
Expected: suite PASS; `BYTE-UNCHANGED`.

- [ ] **Step 2.5: Commit.**

```bash
git add packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts
git commit -m "refactor(ad-optimizer): extract the sink's emitted risk contract into one producer"
```

---

### Task 3: `deriveOwnership` + `deriveOwnershipAnnotations` (pure module) + barrel exports

**Files:**

- Create: `packages/ad-optimizer/src/recommendation-ownership.ts`
- Create: `packages/ad-optimizer/src/recommendation-ownership.test.ts`
- Modify: `packages/ad-optimizer/src/index.ts` (barrel)

- [ ] **Step 3.1: Write the failing tests.** Create `packages/ad-optimizer/src/recommendation-ownership.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import {
  deriveOwnership,
  deriveOwnershipAnnotations,
  type DeriveOwnershipInput,
} from "./recommendation-ownership.js";
import { emittedRiskContractFor } from "./recommendation-sink.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";
import type { RecommendationOutputSchema as RecommendationOutput } from "@switchboard/schemas";
import { resetsLearningFor } from "./action-reset-classification.js";

const ALL_ACTIONS = AdRecommendationActionSchema.options;
const ALL_URGENCIES = UrgencySchema.options;

/** Clears BOTH creative floors (destructive is the higher bar: 50/5/7). */
const PASSING_CONTEXT: HandoffCampaignContext = {
  evidence: { clicks: 50, conversions: 5, days: 7 },
  learningPhaseActive: false,
};
/** Below the diagnostic floor (clicks 10), so it fails refresh_creative too. */
const THIN_CONTEXT: HandoffCampaignContext = {
  evidence: { clicks: 9, conversions: 0, days: 3 },
  learningPhaseActive: false,
};
const LOCKED_CONTEXT: HandoffCampaignContext = {
  evidence: { clicks: 50, conversions: 5, days: 7 },
  learningPhaseActive: true,
};
const CONTEXT_VARIANTS: ReadonlyArray<HandoffCampaignContext | undefined> = [
  undefined,
  PASSING_CONTEXT,
  THIN_CONTEXT,
  LOCKED_CONTEXT,
];

function rec(overrides: Partial<RecommendationOutput> = {}): RecommendationOutput {
  const action = overrides.action ?? "pause";
  return {
    type: "recommendation",
    action,
    campaignId: "c-1",
    campaignName: "C1",
    confidence: 0.9,
    urgency: "this_week",
    estimatedImpact: "x",
    steps: ["x"],
    learningPhaseImpact: "no impact",
    resetsLearning: resetsLearningFor(action),
    ...overrides,
  };
}

describe("deriveOwnership: per-class pins", () => {
  it("mira_handoff: a creative rec whose LIVE abstention gate clears", () => {
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: PASSING_CONTEXT,
      }),
    ).toBe("mira_handoff");
    expect(
      deriveOwnership({
        action: "add_creative",
        urgency: "this_week",
        handoffContext: PASSING_CONTEXT,
      }),
    ).toBe("mira_handoff");
    // The diagnostic floor (10/0/3) passes refresh_creative but the destructive
    // floor (50/5/7) fails add_creative: per-action floors via the live gate.
    const diagnosticOnly: HandoffCampaignContext = {
      evidence: { clicks: 10, conversions: 0, days: 3 },
      learningPhaseActive: false,
    };
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: diagnosticOnly,
      }),
    ).toBe("mira_handoff");
    expect(
      deriveOwnership({
        action: "add_creative",
        urgency: "this_week",
        handoffContext: diagnosticOnly,
      }),
    ).toBe("operator_approval");
  });

  it("a creative rec falls to the operator classes when evidence fails, learning is locked, or context is absent", () => {
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: THIN_CONTEXT,
      }),
    ).toBe("operator_approval");
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "this_week",
        handoffContext: LOCKED_CONTEXT,
      }),
    ).toBe("operator_approval");
    expect(deriveOwnership({ action: "refresh_creative", urgency: "this_week" })).toBe(
      "operator_approval",
    );
    expect(deriveOwnership({ action: "refresh_creative", urgency: "immediate" })).toBe(
      "human_escalation",
    );
  });

  it("operator_swipe: low-risk informational actions only (non-mutating + next_cycle)", () => {
    for (const action of [
      "hold",
      "test",
      "harden_capi_attribution",
      "fix_signal_health",
    ] as const) {
      expect(deriveOwnership({ action, urgency: "next_cycle" })).toBe("operator_swipe");
      expect(deriveOwnership({ action, urgency: "this_week" })).toBe("operator_approval");
      expect(deriveOwnership({ action, urgency: "immediate" })).toBe("human_escalation");
    }
  });

  it("mutating actions are never swipe-owned at any urgency", () => {
    for (const action of ALL_ACTIONS) {
      const c = emittedRiskContractFor(action, "next_cycle");
      if (!c.financialEffect && !c.externalEffect) continue; // informational quartet
      expect(deriveOwnership({ action, urgency: "next_cycle" })).toBe("operator_approval");
      expect(deriveOwnership({ action, urgency: "immediate" })).toBe("human_escalation");
    }
  });

  it("human_escalation: precedence pin against the handoff (live-behavior fidelity)", () => {
    // An immediate-urgency creative rec that clears the gates is Mira-owned: the
    // live dispatch hands off regardless of urgency (the abstention reads no
    // urgency) and the parked draft IS the governed approval ceremony.
    expect(
      deriveOwnership({
        action: "refresh_creative",
        urgency: "immediate",
        handoffContext: PASSING_CONTEXT,
      }),
    ).toBe("mira_handoff");
  });
});

describe("deriveOwnership: domain sweeps (riley_self reservation + structural exclusivity)", () => {
  it("never emits riley_self and always emits a known class over the full input domain", () => {
    const EMITTABLE = ["operator_swipe", "operator_approval", "mira_handoff", "human_escalation"];
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        for (const handoffContext of CONTEXT_VARIANTS) {
          const input: DeriveOwnershipInput = { action, urgency, handoffContext };
          expect(EMITTABLE, `${action}/${urgency}`).toContain(deriveOwnership(input));
        }
      }
    }
  });

  it("handoff-and-swipe is structurally impossible (mira_handoff never masks a swipe-eligible rec)", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const ownership = deriveOwnership({ action, urgency, handoffContext: PASSING_CONTEXT });
        if (ownership === "mira_handoff") {
          const c = emittedRiskContractFor(action, urgency);
          const swipeEligible =
            c.riskLevel === "low" && !c.externalEffect && !c.financialEffect && !c.clientFacing;
          expect(swipeEligible, `${action}/${urgency}`).toBe(false);
        }
      }
    }
  });

  it("swipe-and-escalation is structurally impossible (low vs high risk)", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const ownership = deriveOwnership({ action, urgency });
        if (ownership === "operator_swipe") {
          expect(emittedRiskContractFor(action, urgency).riskLevel).toBe("low");
        }
        if (ownership === "human_escalation") {
          expect(emittedRiskContractFor(action, urgency).riskLevel).toBe("high");
        }
      }
    }
  });
});

describe("deriveOwnershipAnnotations: total, ordered, index-faithful", () => {
  it("annotates every recommendation in order, resolving context per campaign", () => {
    const recommendations = [
      rec({ action: "pause", campaignId: "c-1", urgency: "immediate" }),
      rec({ action: "refresh_creative", campaignId: "c-2", urgency: "this_week" }),
      rec({ action: "refresh_creative", campaignId: "c-3", urgency: "this_week" }),
      rec({ action: "shift_budget_to_source", campaignId: "account", urgency: "this_week" }),
      rec({ action: "fix_signal_health", campaignId: "signal:px-1", urgency: "this_week" }),
      rec({ action: "fix_signal_health", campaignId: "signal:px-1", urgency: "this_week" }),
    ];
    const contexts = new Map<string, HandoffCampaignContext>([
      ["c-2", PASSING_CONTEXT],
      ["c-3", THIN_CONTEXT],
    ]);
    const out = deriveOwnershipAnnotations({ recommendations, handoffContextByCampaign: contexts });
    expect(out).toHaveLength(6);
    expect(out.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out[0]).toEqual({
      campaignId: "c-1",
      action: "pause",
      index: 0,
      ownership: "human_escalation",
    });
    expect(out[1]?.ownership).toBe("mira_handoff");
    expect(out[2]?.ownership).toBe("operator_approval");
    expect(out[3]?.ownership).toBe("operator_approval");
    // Duplicate (campaignId, action) pairs stay distinguishable by index.
    expect(out[4]?.ownership).toBe("operator_approval");
    expect(out[5]?.ownership).toBe("operator_approval");
    expect(out[4]?.index).not.toBe(out[5]?.index);
  });

  it("returns [] for no candidates and never mutates its input", () => {
    expect(deriveOwnershipAnnotations({ recommendations: [] })).toEqual([]);
    const recommendations = [rec({ action: "hold", urgency: "next_cycle" })];
    const frozen = Object.freeze(recommendations);
    const out = deriveOwnershipAnnotations({ recommendations: frozen });
    expect(out[0]?.ownership).toBe("operator_swipe");
  });

  it("never emits riley_self across a mixed candidate set (annotation-level sweep)", () => {
    const recommendations = ALL_ACTIONS.flatMap((action) =>
      ALL_URGENCIES.map((urgency) => rec({ action, urgency, campaignId: "c-all" })),
    );
    for (const context of CONTEXT_VARIANTS) {
      const out = deriveOwnershipAnnotations({
        recommendations,
        handoffContextByCampaign: context ? new Map([["c-all", context]]) : undefined,
      });
      expect(out).toHaveLength(recommendations.length);
      for (const entry of out) {
        expect(entry.ownership).not.toBe("riley_self");
      }
    }
  });
});
```

- [ ] **Step 3.2: Run to verify failure.**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-ownership`
Expected: FAIL (module does not exist).

- [ ] **Step 3.3: Implement.** Create `packages/ad-optimizer/src/recommendation-ownership.ts`:

```ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  OwnershipClassSchema as OwnershipClass,
  RecommendationOutputSchema as RecommendationOutput,
  UrgencySchema as Urgency,
} from "@switchboard/schemas";
import { emittedRiskContractFor } from "./recommendation-sink.js";
import { shouldAbstainFromHandoff } from "./recommendation-handoff-abstention.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";

/**
 * Riley v3 (spec 2.2 net-new item 1): ownership as ONE derivation instead of five
 * scattered fragments. Classifies who should own the fix for a recommendation:
 *
 *   mira_handoff      the LIVE handoff abstention clears (allowlist -> evidence
 *                     floor -> learning lock; the same shouldAbstainFromHandoff
 *                     the dispatch runs, called directly, never re-implemented)
 *   operator_swipe    the dashboard's canSwipeApprove predicate over the sink's
 *                     emitted risk contract (cross-package parity tripwire:
 *                     apps/dashboard .../swipe-policy.parity.test.ts)
 *   human_escalation  the dashboard's needsConfirm tier reduced to its reachable
 *                     arm (riskLevel high; requiresConfirmation is constant-false
 *                     and the contract is always present at this site)
 *   operator_approval the default tier
 *
 * Precedence (first match): mira_handoff -> operator_swipe -> human_escalation ->
 * operator_approval. Handoff-and-swipe is structurally impossible (creative
 * actions elevate to mutating); swipe-and-escalation is impossible (low vs high
 * risk); the only live overlap, handoff-and-escalation, resolves to mira_handoff
 * by live-behavior fidelity (the dispatch hands off regardless of urgency; the
 * parked draft IS the governed approval ceremony).
 *
 * HONEST INPUT SET (recorded in the plan, spec 7.7 discipline): action, urgency,
 * and the captured per-campaign handoff context. revenueState is deliberately NOT
 * an input (no live ownership gate reads it). The governance approval mode is NOT
 * honestly available at this Layer-2 site (the gate's verdict is per-request at
 * act/submit time in core; the seeded handoff policy parks mandatory approval; an
 * injected snapshot would be a fabricated read): it becomes the live discriminator
 * only in Phase-C, reserved alongside riley_self below.
 *
 * Ownership ANNOTATES; it gates nothing. Classification is by the GATE, not the
 * dispatch: surface routing (dropped), submitter wiring, and deploymentId are
 * dispatch mechanics that do not change who should own the fix.
 */

/** The classes the advisory derivation can emit. riley_self is PHASE-C RESERVED:
 * wire-ready on OwnershipClassSchema, excluded here at the type level, and pinned
 * never-emitted by the domain sweep tests. */
export type EmittableOwnershipClass = Exclude<OwnershipClass, "riley_self">;

export interface DeriveOwnershipInput {
  action: AdRecommendationAction;
  urgency: Urgency;
  /** The campaign's captured handoff-gate inputs (evidence + learning phase).
   * Absent for account-scoped and signal recs (and any campaign outside this
   * cycle's insight set); absence fails the handoff arm honestly, mirroring
   * buildHandoffCandidate's null-without-context. */
  handoffContext?: HandoffCampaignContext | undefined;
}

export function deriveOwnership(input: DeriveOwnershipInput): EmittableOwnershipClass {
  if (input.handoffContext) {
    const abstention = shouldAbstainFromHandoff({
      actionType: input.action,
      evidence: input.handoffContext.evidence,
      learningPhaseActive: input.handoffContext.learningPhaseActive,
    });
    if (!abstention.abstain) return "mira_handoff";
  }
  const contract = emittedRiskContractFor(input.action, input.urgency);
  if (
    contract.riskLevel === "low" &&
    !contract.externalEffect &&
    !contract.financialEffect &&
    !contract.clientFacing
  ) {
    return "operator_swipe";
  }
  if (contract.requiresConfirmation || contract.riskLevel === "high") {
    return "human_escalation";
  }
  return "operator_approval";
}

/** One ownership entry per recommendations[] element (the report-level annotation;
 * same entry-identity rule as arbitration: index = array position). */
export interface OwnershipAnnotation {
  campaignId: string;
  action: AdRecommendationAction;
  index: number;
  ownership: EmittableOwnershipClass;
}

/** Total annotation over the final candidate set: one entry per recommendation,
 * same order. Pure; never mutates input. */
export function deriveOwnershipAnnotations(args: {
  recommendations: ReadonlyArray<RecommendationOutput>;
  handoffContextByCampaign?: ReadonlyMap<string, HandoffCampaignContext> | undefined;
}): OwnershipAnnotation[] {
  return args.recommendations.map((r, index) => ({
    campaignId: r.campaignId,
    action: r.action,
    index,
    ownership: deriveOwnership({
      action: r.action,
      urgency: r.urgency,
      handoffContext: args.handoffContextByCampaign?.get(r.campaignId),
    }),
  }));
}
```

- [ ] **Step 3.4: Barrel exports.** In `packages/ad-optimizer/src/index.ts`, after the slice-2 arbitrator export block, add:

```ts
// Riley v3 (spec 2.2): the ownership derivation and the single five-field
// emitted-risk-contract producer (the dashboard parity tripwire and any future
// operator surface consume these through the barrel). deriveOwnershipAnnotations
// stays package-internal (only the audit runner builds the report annotation).
export { deriveOwnership } from "./recommendation-ownership.js";
export type {
  DeriveOwnershipInput,
  EmittableOwnershipClass,
  OwnershipAnnotation,
} from "./recommendation-ownership.js";
export { emittedRiskContractFor } from "./recommendation-sink.js";
export type { EmittedRiskContract } from "./recommendation-sink.js";
```

- [ ] **Step 3.5: Run to verify pass + eval byte-compare (pure addition; nothing calls it yet).**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build && pnpm typecheck && pnpm eval:riley > /tmp/dob-baselines/eval-riley.task3.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.task3.txt && echo BYTE-UNCHANGED`
Expected: PASS; `BYTE-UNCHANGED`.

- [ ] **Step 3.6: Commit.**

```bash
git add packages/ad-optimizer/src/recommendation-ownership.ts packages/ad-optimizer/src/recommendation-ownership.test.ts packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): deriveOwnership (pure ownership classification over live gates)"
```

---

### Task 4: Audit runner: always-built context map + Step 8e ownership annotation

**Files:**

- Modify: `packages/ad-optimizer/src/audit-runner.ts` (context-map declaration ~`:313`; per-loop set ~`:509`; sink call ~`:641`; new Step 8e after arbitration ~`:625`; report spread ~`:683`; import)
- Test: `packages/ad-optimizer/src/__tests__/audit-runner-ownership.test.ts` (new; mirror the arbitration test's fixture builders)

- [ ] **Step 4.1: Write the failing integration tests.** Create `packages/ad-optimizer/src/__tests__/audit-runner-ownership.test.ts`. The fixture builders (`makeCampaignInsight`, `makeAccountSummary`, `makeFunnelData`, `makeCrmBenchmarks`, `makeMediaBenchmarks`, `makeLearningInput`, `makeBreachingTargetBreach`) are copied VERBATIM from `audit-runner-arbitration.test.ts:27-110` (each test file owns its builders per the existing convention); the signal-red `makeReport` fixture is copied from `audit-runner.test.ts` (`signal-health pre-check` describe, ~`:498-532`). Full file:

```ts
import { describe, it, expect, vi } from "vitest";
import { AuditRunner } from "../audit-runner.js";
import type {
  AuditDependencies,
  AdsClientInterface,
  AuditConfig,
  BookedValueByCampaignProvider,
} from "../audit-runner.js";
import type {
  CampaignInsightSchema as CampaignInsight,
  AccountSummarySchema as AccountSummary,
  CrmDataProvider,
  CrmFunnelData,
  FunnelBenchmarks,
  MediaBenchmarks,
  CampaignInsightsProvider,
  CampaignLearningInput,
  TargetBreachResult,
  RecommendationInput,
} from "@switchboard/schemas";
import { emittedRiskContractFor } from "../recommendation-sink.js";

// Riley v3 (spec 2.2 net-new item 1): the ownership annotation is ADDITIVE
// metadata over recommendations[]. These integration tests pin (a) a total,
// index-faithful, semantically-correct annotation on the happy path including a
// REACHABLE mira_handoff (context plumbed end to end from the fatigued
// campaign's window insight), (b) ownership derived even with NO emitter and NO
// submitter wired (the context map is runner-internal), (c) emission payloads
// unchanged (no ownership key anywhere; the sink-side context pin in
// audit-runner-handoff.test.ts:191 stays UNFLIPPED and that file UNMODIFIED),
// and (d) no ownership field on either abort report.

// [transplant makeCampaignInsight + makeAccountSummary + makeFunnelData +
//  makeCrmBenchmarks + makeMediaBenchmarks + makeLearningInput +
//  makeBreachingTargetBreach VERBATIM from audit-runner-arbitration.test.ts here]

/** camp-2, previous period: healthy engagement baseline. */
function makeFatiguePrevInsight(): CampaignInsight {
  return makeCampaignInsight({
    campaignId: "camp-2",
    campaignName: "Fatigued Campaign",
    impressions: 100_000,
    inlineLinkClicks: 3_000,
    spend: 5_000,
    conversions: 40,
    revenue: 8_000,
    frequency: 2.0,
    cpm: 50,
    inlineLinkClickCtr: 3.0,
    costPerInlineLinkClick: 1.67,
  });
}

/** camp-2, current period: creative_fatigue per metric-diagnostician RULES
 * (15% significance threshold): CTR 3.0 -> 1.8 (down 40%, significant);
 * frequency 2.0 -> 4.2 (up 110%, significant); CPM 50 -> 50 (not significant);
 * CPA 125 -> 142.9 (up, sub-threshold; rule needs direction up/stable only).
 * Evidence for the handoff gate: clicks 1_800 >= 10, conversions 35 >= 0,
 * windowDays 31 >= 3 (diagnostic floor), learningPhase false. */
function makeFatigueCurrentInsight(): CampaignInsight {
  return makeCampaignInsight({
    campaignId: "camp-2",
    campaignName: "Fatigued Campaign",
    impressions: 100_000,
    inlineLinkClicks: 1_800,
    spend: 5_000,
    conversions: 35,
    revenue: 7_000,
    frequency: 4.2,
    cpm: 50,
    inlineLinkClickCtr: 1.8,
    costPerInlineLinkClick: 2.78,
  });
}

function buildDeps(): AuditDependencies {
  const adsClient: AdsClientInterface = {
    getCampaignInsights: vi
      .fn()
      // Current period first (Promise.all arg order): camp-1 breaches the target
      // (mutating recs); camp-2 is the creative-fatigue campaign.
      .mockResolvedValueOnce([
        makeCampaignInsight({ spend: 8_000, conversions: 35, revenue: 2_000 }),
        makeFatigueCurrentInsight(),
      ])
      .mockResolvedValueOnce([
        makeCampaignInsight({ spend: 4_800, conversions: 40, revenue: 12_000 }),
        makeFatiguePrevInsight(),
      ]),
    getAdSetInsights: vi.fn().mockResolvedValue([]),
    getAccountSummary: vi.fn().mockResolvedValue(makeAccountSummary()),
  };
  const crmDataProvider: CrmDataProvider = {
    getFunnelData: vi.fn().mockResolvedValue(makeFunnelData()),
    getBenchmarks: vi.fn().mockResolvedValue(makeCrmBenchmarks()),
  };
  const insightsProvider: CampaignInsightsProvider = {
    getCampaignLearningData: vi.fn().mockResolvedValue(makeLearningInput()),
    // camp-1 durably breaches (mutating recs); camp-2 does not (its recs stay
    // purely fatigue-driven so the mira_handoff pin is deterministic).
    getTargetBreachStatus: vi
      .fn()
      .mockImplementation((args: { campaignId: string }) =>
        Promise.resolve(
          args.campaignId === "camp-1"
            ? makeBreachingTargetBreach()
            : { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
        ),
      ),
  };
  const bookedValueProvider: BookedValueByCampaignProvider = {
    queryBookedValueCentsByCampaign: vi.fn().mockResolvedValue(new Map<string, number>()),
  };
  const config: AuditConfig = {
    accountId: "act-123",
    orgId: "org-1",
    targetCPA: 100,
    targetROAS: 3.0,
    mediaBenchmarks: makeMediaBenchmarks(),
  };
  return {
    adsClient,
    crmDataProvider,
    insightsProvider,
    config,
    bookedValueByCampaignProvider: bookedValueProvider,
  };
}

const RANGE = {
  dateRange: { since: "2026-03-01", until: "2026-03-31" },
  previousDateRange: { since: "2026-02-01", until: "2026-02-28" },
};

const EMITTABLE = ["operator_swipe", "operator_approval", "mira_handoff", "human_escalation"];

describe("audit-runner ownership annotation (Riley v3)", () => {
  it("annotates every recommendation, index-faithful and tier-correct, with a reachable mira_handoff", async () => {
    const runner = new AuditRunner(buildDeps());
    const report = await runner.run(RANGE);

    // The fixtures must produce candidates or this test pins nothing.
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.ownership).toBeDefined();
    expect(report.ownership).toHaveLength(report.recommendations.length);

    report.ownership?.forEach((entry, i) => {
      const rec = report.recommendations[i]!;
      expect(entry.index).toBe(i);
      expect(entry.campaignId).toBe(rec.campaignId);
      expect(entry.action).toBe(rec.action);
      expect(EMITTABLE).toContain(entry.ownership); // riley_self never appears
      // D3 tier semantics re-derived from the rec's own fields (not an echo of
      // deriveOwnership: this pins the runner wired the right context + urgency).
      const c = emittedRiskContractFor(rec.action, rec.urgency);
      if (entry.ownership === "mira_handoff") {
        expect(["refresh_creative", "add_creative"]).toContain(rec.action);
      } else if (c.financialEffect || c.externalEffect) {
        expect(entry.ownership).toBe(
          rec.urgency === "immediate" ? "human_escalation" : "operator_approval",
        );
      } else {
        expect(entry.ownership).toBe(
          rec.urgency === "next_cycle"
            ? "operator_swipe"
            : rec.urgency === "immediate"
              ? "human_escalation"
              : "operator_approval",
        );
      }
    });

    // The fatigue campaign produced a creative rec and it is Mira-owned: the
    // evidence flowed from the window insight (clicks 1_800 / conversions 35 /
    // 31 days) through the runner-internal context map into the live gate.
    const creativeIdx = report.recommendations.findIndex(
      (r) => r.action === "refresh_creative" && r.campaignId === "camp-2",
    );
    expect(creativeIdx).toBeGreaterThanOrEqual(0);
    expect(report.ownership?.[creativeIdx]?.ownership).toBe("mira_handoff");
  });

  it("derives ownership with NO emitter and NO submitter (annotation independent of the Mira wire)", async () => {
    const runner = new AuditRunner(buildDeps()); // analysis-only: no emitter, no submitter
    const report = await runner.run(RANGE);
    expect(report.ownership).toBeDefined();
    expect(report.ownership?.length).toBe(report.recommendations.length);
    const creative = report.ownership?.find((e) => e.action === "refresh_creative");
    expect(creative?.ownership).toBe("mira_handoff");
  });

  it("emission payloads carry no ownership key (additive: the sink never sees it)", async () => {
    const deps = buildDeps();
    const emitted: RecommendationInput[] = [];
    const emitter = vi.fn(async (input: RecommendationInput) => {
      emitted.push(input);
      return { surface: "queue" as const };
    });
    const runner = new AuditRunner({
      ...deps,
      recommendationEmitter: emitter,
      recommendationEmissionContext: { cronId: "cron-test" },
    });
    const report = await runner.run(RANGE);
    expect(emitter).toHaveBeenCalledTimes(report.recommendations.length);
    for (const input of emitted) {
      expect(JSON.stringify(input)).not.toContain('"ownership"');
    }
  });

  it("abort reports carry no ownership field (Gate-0 coverage + signal-health red)", async () => {
    // Gate-0 coverage abstention.
    const gateDeps = buildDeps();
    const coverageValidator = {
      validate: vi.fn().mockResolvedValue({
        coveragePct: 0.2,
        bySource: {
          ctwa: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
          web: { campaigns: 1, spend: 200, tracking: "no_recent_traffic" },
        },
      }),
    };
    const gateRunner = new AuditRunner({ ...gateDeps, coverageValidator });
    const gateReport = await gateRunner.run(RANGE);
    expect(gateReport.recommendations).toEqual([]);
    expect(gateReport.ownership).toBeUndefined();

    // Signal-health red short-circuit (makeReport transplanted from
    // audit-runner.test.ts signal-health describe).
    const redDeps = buildDeps();
    const checker = {
      getSignalHealthReport: vi.fn().mockResolvedValue(
        makeReport({
          score: "red",
          breaches: [{ signal: "pixel_dead", severity: "critical", message: "Pixel dead." }],
        }),
      ),
    };
    const redRunner = new AuditRunner({
      ...redDeps,
      signalHealthChecker: checker as never,
      config: { ...redDeps.config, pixelId: "px_1" },
    });
    const redReport = await redRunner.run(RANGE);
    expect(redReport.ownership).toBeUndefined();
  });
});
```

(The two `[transplant ...]` markers are the ONLY non-literal parts: copy those builders verbatim from the named files at execution time so the fixtures cannot drift from the precedent tests. If the fatigue fixture fails to produce `refresh_creative`, the hard `creativeIdx >= 0` assertion fails loudly: adjust the camp-2 deltas against `metric-diagnostician.ts` RULES until the diagnosis fires; do not weaken the assertion.)

- [ ] **Step 4.2: Run to verify failure.**

Run: `pnpm --filter @switchboard/ad-optimizer test -- audit-runner-ownership`
Expected: FAIL (`report.ownership` undefined).

- [ ] **Step 4.3: Implement.** In `packages/ad-optimizer/src/audit-runner.ts`:

(a) Import:

```ts
import { deriveOwnershipAnnotations } from "./recommendation-ownership.js";
```

(b) Replace the conditional context-map declaration (~`:313-315`):

```ts
// Per-campaign handoff-gate context (evidence + learning phase), captured for
// EVERY run since Riley v3 ownership reads it (Step 8e). The sink still
// receives it only alongside a submitter (see Step 9), so the sink-visible
// contract and the handoff path are byte-identical to pre-ownership behavior.
const handoffContextByCampaign = new Map<string, HandoffCampaignContext>();
```

(c) In the per-campaign loop (~`:509-512`), drop the optional chain:

```ts
handoffContextByCampaign.set(
  insight.campaignId,
  handoffContextFromInsight(insight, windowDays, learningPhaseActive),
);
```

(d) After Step 8d (arbitration, ~`:625`), add Step 8e:

```ts
// Step 8e (Riley v3, spec 2.2 net-new item 1): per-recommendation ownership
// annotation, ADDITIVE like arbitration above; it never filters emission or
// handoff. Reads the always-built per-campaign handoff context.
const ownership =
  recommendations.length > 0
    ? deriveOwnershipAnnotations({ recommendations, handoffContextByCampaign })
    : undefined;
```

(e) In the Step 9 sink call (~`:641`), preserve the sink-visible contract:

```ts
        handoffContextByCampaign: this.recommendationHandoffSubmitter
          ? handoffContextByCampaign
          : undefined,
```

(f) In the report assembly (~`:683`), after the arbitration spread:

```ts
      ...(ownership ? { ownership } : {}),
```

- [ ] **Step 4.4: Run to verify pass + the unflipped pin + eval byte-compare.**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley > /tmp/dob-baselines/eval-riley.task4.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.task4.txt && echo BYTE-UNCHANGED`
Expected: full ad-optimizer suite PASS (including `audit-runner-handoff.test.ts` UNMODIFIED and green); `BYTE-UNCHANGED`.

- [ ] **Step 4.5: Commit.**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/__tests__/audit-runner-ownership.test.ts
git commit -m "feat(ad-optimizer): annotate per-recommendation ownership on the audit report"
```

---

### Task 5: Dashboard parity tripwire (spec 7.7: duplication can never be silent)

**Files:**

- Modify: `apps/dashboard/package.json` (devDependencies: add `"@switchboard/ad-optimizer": "workspace:*"`, sorted before `@testing-library/jest-dom`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)
- Create: `apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts`

- [ ] **Step 5.1: Add the test-only devDependency.**

```bash
# edit apps/dashboard/package.json devDependencies, then:
pnpm install
```

- [ ] **Step 5.2: Write the failing test** (fails before the dep lands; passes after). Create `apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts` (dashboard imports omit `.js`):

```ts
import { describe, expect, it } from "vitest";
import { deriveOwnership, emittedRiskContractFor } from "@switchboard/ad-optimizer";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import { canSwipeApprove, needsConfirm } from "../swipe-policy";

/**
 * Riley v3 spec-7.7 parity tripwire. The dashboard keeps its generic risk-contract
 * gate (it serves parked approvals, legacy rows, and any future producer), and the
 * backend's deriveOwnership restates the swipe predicate once. This test makes
 * that restatement IMPOSSIBLE TO DRIFT SILENTLY: it enumerates the full
 * action x urgency domain against the SAME five-field contract the sink emits
 * (emittedRiskContractFor is the sink's own producer) and fails CI when either
 * side moves (a new action, a changed elevation, an URGENCY_TO_RISK change, or a
 * swipe-policy edit).
 */

const ALL_ACTIONS = AdRecommendationActionSchema.options;
const ALL_URGENCIES = UrgencySchema.options;
/** Clears both creative floors (destructive is the higher bar: 50/5/7). */
const PASSING_CONTEXT = {
  evidence: { clicks: 50, conversions: 5, days: 7 },
  learningPhaseActive: false,
};
const CONTEXT_VARIANTS = [undefined, PASSING_CONTEXT] as const;

describe("swipe-policy parity tripwire (Riley v3 ownership, spec 7.7)", () => {
  it("canSwipeApprove(emitted contract) === (ownership === operator_swipe) over the full domain", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const contract = emittedRiskContractFor(action, urgency);
        for (const handoffContext of CONTEXT_VARIANTS) {
          const ownership = deriveOwnership({ action, urgency, handoffContext });
          expect(
            canSwipeApprove(contract),
            `${action}/${urgency}/ctx=${handoffContext ? "passing" : "none"}`,
          ).toBe(ownership === "operator_swipe");
        }
      }
    }
  });

  it("needsConfirm(emitted contract) === (ownership === human_escalation) wherever the operator owns the decision", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const contract = emittedRiskContractFor(action, urgency);
        for (const handoffContext of CONTEXT_VARIANTS) {
          const ownership = deriveOwnership({ action, urgency, handoffContext });
          if (ownership === "mira_handoff") continue; // Mira owns the fix; the confirm step is approval mechanics
          expect(
            needsConfirm(contract),
            `${action}/${urgency}/ctx=${handoffContext ? "passing" : "none"}`,
          ).toBe(ownership === "human_escalation");
        }
      }
    }
  });

  it("a clearing handoff gate never coexists with a swipe-eligible contract (structural exclusivity)", () => {
    for (const action of ALL_ACTIONS) {
      for (const urgency of ALL_URGENCIES) {
        const ownership = deriveOwnership({ action, urgency, handoffContext: PASSING_CONTEXT });
        if (ownership === "mira_handoff") {
          expect(canSwipeApprove(emittedRiskContractFor(action, urgency))).toBe(false);
        }
      }
    }
  });
});
```

- [ ] **Step 5.3: Run to verify pass.**

Run: `pnpm --filter @switchboard/dashboard test 2>&1 | tail -15`
Expected: PASS, coverage gate (40/35/40/40) green.

- [ ] **Step 5.4: Commit.**

```bash
git add apps/dashboard/package.json pnpm-lock.yaml apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts
git commit -m "test(dashboard): swipe-policy parity tripwire against deriveOwnership"
```

---

### Task 6: Full gates, scope-fence proofs, eval byte-compare record

- [ ] **Step 6.1: Full builds + suites.**

Run:

```bash
pnpm build
pnpm typecheck
pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/core test && pnpm --filter @switchboard/db test; pnpm --filter @switchboard/api test
pnpm --filter @switchboard/dashboard test
```

Expected: all green except the db known trio (compare against the baselined 9 failures: identical set).

- [ ] **Step 6.2: Eval byte-compare (final).**

```bash
pnpm eval:riley > /tmp/dob-baselines/eval-riley.final.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.final.txt && echo RILEY-BYTE-UNCHANGED
pnpm eval:governance > /tmp/dob-baselines/eval-governance.final.txt 2>&1; diff /tmp/dob-baselines/eval-governance.baseline.txt /tmp/dob-baselines/eval-governance.final.txt && echo GOV-BYTE-UNCHANGED
```

Expected: both `BYTE-UNCHANGED`. Record outputs for the PR body. `eval:alex-conversation`: record the env-blocked state (graceful local skip; static proof chain) in the PR body.

- [ ] **Step 6.3: Scope-fence greps (advisory-only + no silent consumer).**

```bash
git diff origin/main...HEAD -- packages/ad-optimizer | grep -n "PlatformIngress" ; echo "exit $? (expect 1: no hits)"
git diff origin/main...HEAD --stat   # only the files this plan names
git diff origin/main...HEAD -- packages/core packages/db apps/api apps/chat | head -5   # expect EMPTY
grep -rn "ownership" packages/ad-optimizer/src/recommendation-sink.ts | grep -v Emitted ; echo "exit $? (expect 1: the sink never reads ownership)"
```

Expected: no `PlatformIngress` in the ad-optimizer diff; zero diff in core/db/api/chat; the sink does not read ownership (emission unchanged by construction).

- [ ] **Step 6.4: Pre-push gates.**

```bash
pnpm format:check
pnpm arch:check
cd .agent/tools && CI=1 pnpm exec tsx check-routes.ts --mode=error; cd ../..
```

Expected: all green (`audit-runner.ts` stays warn-tier behind its existing eslint-disable; no route changes).

---

### Task 7: Rebase, PR, auto-merge, post-merge verify, teardown

- [ ] **Step 7.1:** `git fetch origin main && git rebase origin/main` then re-run: `pnpm build && pnpm typecheck && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter dashboard test && pnpm eval:riley > /tmp/dob-baselines/eval-riley.rebased.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.rebased.txt`. If main moved under the touched files, re-derive anchors before resolving.

- [ ] **Step 7.2:** Push and open ONE focused PR:
- Title: `feat(ad-optimizer,schemas,dashboard): riley v3 deriveOwnership consolidation`
- Body: design decisions D1-D7 summary (wire placement + eval-safety proof, the honest input set incl. the governance non-availability record and the revenueState exclusion, precedence + exclusivity proofs, the spec-7.7 tripwire defense, the riley_self three-level reservation, the single-producer extraction, the unflipped sink-contract pin); scope-fence grep outputs; eval byte-unchanged records incl. the alex-eval env blocker; known-noise notes (db trio, CI flakes, Eval Claim Classifier).

- [ ] **Step 7.3:** `gh pr merge --squash --auto`. Watch required CI; on flake (api-auth prod-hardening, chat gateway-bridge-attribution, bootstrap-smoke npm-warn) rerun before investigating. NEVER `--delete-branch` while any stacked work exists (none planned here).

- [ ] **Step 7.4:** Post-merge: verify the first NON-CANCELLED completed main run containing the squash (the merge train cancels superseded runs; cancelled is not failure; Eval Claim Classifier failure is the known broken secret, not this PR).

- [ ] **Step 7.5:** Same-day teardown: `git worktree remove <path> && git worktree prune`; delete the branch local + remote. Update memory: deriveOwnership shipped; remaining Riley-v3 decision point = slice 5 Phase-C seam when Riley earns execution, plus the optional 4d corroborated / 4e late-interval arms; spec-7.7 revisit-trigger = an operator surface consuming ownership/arbitration (then read-the-field becomes the natural follow-up).

---

## Self-review (spec/prompt coverage)

- Spec 2.2 net-new item 1 (the five scattered inputs -> one derivation): Tasks 2-4 (the derivation + the single five-field producer + the report annotation). Each input's live producer re-derived: swipe gate (Task 5 tripwire), URGENCY_TO_RISK + clientFacing-false (Task 2 emission-parity pins), handoff gate (direct `shouldAbstainFromHandoff` reuse, Task 3), governance mode (recorded NOT honestly available, D2), revenueState (recorded not-an-input, D2).
- Spec 2.3 (static-vs-elevated trap): `emittedRiskContractFor` bakes the elevation from the consolidated contract; Task 2 pins both static-false-but-elevated creative actions.
- Spec 7.7 (no silent duplication): D4 settled as tripwire; Task 5 makes drift CI-fatal; read-the-field revisit-trigger recorded.
- Prompt "exact enum settled": D3 (operator_swipe | operator_approval | mira_handoff | human_escalation; riley_self type-reserved at three levels, D5).
- Prompt "parity proofs against LIVE logic, never re-implementations": handoff arm calls the live gate; swipe/escalation arms read the sink's own producer; the one restated predicate is tripwired cross-package against the live `canSwipeApprove`/`needsConfirm`.
- Prompt "precedence ... deterministic, test-pinned": D3 + Task 3 sweeps + the explicit handoff-over-escalation pin.
- Prompt scope fence: Task 6.3 greps (advisory-only, zero core/db/api/chat diff, emission/handoff/arbitration untouched); dashboard change is test-only (the settled-tripwire arm of the allowed dashboard scope).
- Prompt gates: per-task suite runs + eval byte-compare after every behavior-bearing task (2, 3, 4, final), full matrix in Task 6, pre-push gates 6.4, rebase + re-gate 7.1.
- Eval-sensitivity (12+10+6 pins): no `RecommendationOutputSchema` change; report-level optional field; harness structurally blind (anchor) + byte-compare proof at every step.
