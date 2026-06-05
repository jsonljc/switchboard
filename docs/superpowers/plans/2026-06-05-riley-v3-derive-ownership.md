# Riley v3: deriveOwnership Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (post plan-review).** Changes from revision 1: (1) the emitted-risk-contract producer moves into a NEW pure module `recommendation-risk-contract.ts` instead of being exported from the sink (the sink becomes a consumer; the public barrel never exposes the sink's operational module graph); (2) the report's `ownership` field uses a 4-value `EmittableOwnershipClassSchema`, so today's wire REJECTS `riley_self` at parse time (the 5-value `OwnershipClassSchema` remains as the documented Phase-C target; widening the report field is Phase-C's deliberate one-line change); (3) `mira_handoff` semantics documented as "Mira-owned by gate, not submitted-to-Mira" on the schema and the module (name kept: every class is a should-own classification, none records consummated action; a `dispatchable`/`dispatchBlockReason` companion field is the recorded extension point for the first consuming surface, YAGNI here); (4) the runner integration tests split into two focused files (wiring pins vs the end-to-end handoff-plumbing pin); (5) parity claims rescoped to "Riley emitted-contract parity" (the missing-contract arm of `needsConfirm` guards legacy/non-Riley rows and is out of scope).

**Goal:** Make RevenueOpportunity ownership real (spec 2.2 net-new item 1): one pure `deriveOwnership(...)` in `packages/ad-optimizer` that classifies every audit recommendation as `operator_swipe | operator_approval | mira_handoff | human_escalation` (with `riley_self` type-reserved, never emitted, and rejected by today's report wire), subsuming the dashboard swipe gate, the Mira handoff gate, and the recorded-unavailable governance input, with parity proofs against the LIVE logic and the spec-7.7 placement decision settled as a cross-package parity tripwire.

**Architecture:** A new pure module `recommendation-risk-contract.ts` (Layer 2) owns `URGENCY_TO_RISK` and `emittedRiskContractFor(action, urgency)`, the single producer of the five risk-contract fields; the sink re-points to it (one producer, sink stays an internal adapter), and a pure classification module `recommendation-ownership.ts` reads it plus the LIVE `shouldAbstainFromHandoff` (the same function the dispatch runs). The annotation lands report-level beside `arbitration` (the slice-2 additive precedent): optional Zod field over the 4-value emittable enum, no Prisma model, structurally invisible to the eval harness. The dashboard keeps its generic `canSwipeApprove` gate; a test-only devDependency lets a dashboard parity test (importing ONLY the pure modules through the barrel) enumerate the full domain and fail CI on any drift between the gate and the derivation (spec 7.7: duplication can no longer be silent).

**Tech Stack:** TypeScript ESM monorepo (pnpm + Turborepo); `packages/schemas` (Layer 1), `packages/ad-optimizer` (Layer 2), `apps/dashboard` (Layer 5, test-only consumer); Vitest; `pnpm eval:riley` + `pnpm eval:governance` golden harnesses (byte-unchanged gates).

---

## Global invariants (every task)

- Advisory-only: no new `PlatformIngress` caller in `packages/ad-optimizer`; no Meta write; no new mutating caller. Ownership ANNOTATES; it gates nothing.
- Zero behavior change to decisions, arbitration, emission routing, and handoff gating. The two refactors in this slice (risk-contract extraction into the pure module, unconditional runner-internal context map) are value-identical and pinned by existing tests plus eval byte-compare.
- `pnpm eval:riley` AND `pnpm eval:governance` byte-unchanged against the saved baselines (`/tmp/dob-baselines/eval-riley.baseline.txt`, `/tmp/dob-baselines/eval-governance.baseline.txt`, both green at base SHA `7865b68f`). Diff after every behavior-bearing task. NO new eval fixtures in this slice: an added fixture changes the harness output ("Loaded N ..."), and byte-unchanged is the gate. The derivation is pinned by unit sweeps, integration pins, and the cross-package tripwire instead.
- ESM + `.js` relative imports in packages; dashboard imports omit `.js` (relative AND `@/`); no `any`; co-located `*.test.ts`; no em-dashes anywhere; commitlint lowercase subjects, headers <= 100 chars; lint-staged reformats on commit so re-`git add`; files under the 600-line arch ceiling (`audit-runner.ts` carries the legacy `eslint-disable max-lines` marker, warn-tier: this slice adds ~12 lines of glue there and no more).
- Known local suite noise (baselined at `7865b68f`): db trio always red locally (prisma-work-trace-store-integrity 6, prisma-ledger-storage 2, prisma-greeting-signal-store 1); lead-intake-store concurrency can flake under full-suite load; api-auth prod-hardening + chat gateway-bridge-attribution + bootstrap-smoke npm-warn are CI flakes (rerun before investigating); the Eval Claim Classifier job fails every main push (broken Actions secret, informational). `eval:alex-conversation` is env-blocked locally (no `ANTHROPIC_API_KEY` in the shell; graceful skip off main): ship on the static proof chain and say so in the PR.

## Verified live anchors (origin/main @ `7865b68f`, audited 2026-06-05; re-verify if drifted)

- Swipe gate: `apps/dashboard/src/lib/decisions/swipe-policy.ts:8-10` `canSwipeApprove(c) = !!c && c.riskLevel === "low" && !c.externalEffect && !c.financialEffect && !c.clientFacing`; `needsConfirm(c) = !c || c.requiresConfirmation || c.riskLevel === "high"` (`:17-19`). Live callers: `inbox-decision-card.tsx:57` (handoffs hard-excluded first), `decisions/swipe-decision-card.tsx:50-51`, `approval-detail-sheet.tsx:116`, `inbox-drawer.tsx:97`.
- The dashboard `RiskContract` (`apps/dashboard/src/lib/decisions/types.ts:11-17`) mirrors core `Decision.meta.riskContract`, built 1:1 from the persisted Recommendation row in `packages/core/src/decisions/adapters/recommendation-adapter.ts:32-38` (`?? false` defaults).
- Sink emission (`packages/ad-optimizer/src/recommendation-sink.ts`): `URGENCY_TO_RISK` (immediate=high, this_week=medium, next_cycle=low, `:119-123`, module-private, no other consumer); per-rec fields at `:419-438`: `financialEffect = contract.financialEffect`, `externalEffect = contract.externalEffect || rec.resetsLearning === "yes"` (the elevation, `:424`), `clientFacing: false` ALWAYS (`:437`; Riley does not message clients), `requiresConfirmation: false` ALWAYS (`:438`). The sink's only `ACTION_CONTRACT` use is this block.
- Elevated contract: `packages/ad-optimizer/src/action-contract.ts` `ACTION_CONTRACT` (14 actions) + `isMutating = financialEffect || externalEffect || resetsLearning === "yes"` (`:133-136`). Both creative actions (`refresh_creative`, `add_creative`) are static-false/false but `resetsLearning: "yes"`, so they are mutating after elevation and can NEVER pass the swipe gate.
- Handoff gate: `recommendation-handoff-abstention.ts` `CREATIVE_HANDOFF_ACTIONS = {refresh_creative, add_creative}`; `shouldAbstainFromHandoff({actionType, evidence, learningPhaseActive})` checks routability, then `meetsEvidenceFloor`, then learning lock. Evidence floors (`evidence-floor.ts:14-20`): diagnostic (refresh_creative) clicks>=10/conv>=0/days>=3; destructive (add_creative) clicks>=50/conv>=5/days>=7.
- Gate vs dispatch split: `buildHandoffCandidate` (`recommendation-handoff-dispatch.ts:88-115`) additionally requires a non-dropped surface, a captured context, and a deploymentId. Those are DISPATCH mechanics; ownership classifies by the GATE (see Decision D3).
- Runner: `audit-runner.ts:313-315` builds `handoffContextByCampaign` ONLY when a submitter is wired; `:509-512` populates it per campaign via `handoffContextFromInsight` (pure, no Graph call); Step 8d arbitration at `:617-625` is the additive report-annotation precedent; Step 9 sink call at `:634-646` passes the context map. `audit-runner-handoff.test.ts:191` pins `sinkArgs.handoffContextByCampaign === undefined` without a submitter; this pin MUST stand unflipped.
- Report schema: `packages/schemas/src/ad-optimizer.ts:221-313`; `arbitration` (`:286-312`) is the entry-shape precedent `{campaignId, action, index, score}` (index disambiguates: campaignId+action is not unique, e.g. per-breach `fix_signal_health` recs). `AuditReportSchema` is type-only outside schemas (no runtime `.parse` consumer in apps/packages); the report persists as AgentTask JSON output.
- Eval harness: `evals/riley-recommendation/run-eval.ts` is assertion-based (12 decideForCampaign + 10 source-reallocation + 6 arbitration cases), never constructs an AuditRunner, never serializes an AuditReport. A report-level field is structurally invisible to it.
- Governance reality at the emission site: ad-optimizer (Layer 2) cannot import core (Layer 3). The gate verdict is per-request at act/submit time: `operator.act_on_recommendation` evaluates when the OPERATOR acts; the handoff intent `adoptimizer.recommendation.handoff` is parked for mandatory human approval by a SEEDED policy (its registration's `approvalPolicy` is documented "decorative"; the policy engine reads the seeded `policyApprovalOverride`). The app seam (`apps/api/src/bootstrap/inngest.ts:387`) injects no governance verdict into the audit.
- `creative_fatigue` diagnosis (`metric-diagnostician.ts` RULES, 15% significance threshold in `period-comparator.ts:21`): CTR down-significant AND frequency up-significant AND CPM not-significant AND CPA direction up/stable.

## Design decisions (settled in brainstorm + revised per plan review; do not re-litigate mid-build)

**D1. Wire placement: report-level sibling annotation over the EMITTABLE enum.** `ownership` lands beside `arbitration` on `AuditReportSchema` as an optional array, one entry per `recommendations[]` element, same order: `{campaignId, action, index, ownership}` where `ownership` is `EmittableOwnershipClassSchema` (4 values). Today's report wire REJECTS `riley_self` at parse time; Phase-C widens the field to the 5-value enum deliberately and loudly. Rejected alternatives: (a) a field on `RecommendationOutputSchema` (the eval-pinned per-rec shape; ownership needs handoff context that does not exist inside `decideForCampaign`, which runs before the v2/reallocation/signal candidates exist); (b) emission-level persistence through core (that is the read-the-field wire: core types + emit + adapter churn for a slice whose scope fence says ownership annotates and nothing consumes it yet). Eval safety is proved by byte-compare, not asserted: the harness never builds an AuditRunner (anchor above), plus integration pins that abort reports carry no `ownership` key and emission payloads are unchanged.

**D2. The honest input set is `(action, urgency, handoffContext?)`.** Re-derived per spec-signature input:

- `opportunity` -> `action` + `urgency` + `campaignId` (the rec itself).
- `actionContract` -> read in-package (`ACTION_CONTRACT` is total over the 14 actions; the elevated form arrives via `emittedRiskContractFor`).
- `urgency` -> `riskLevel` via `URGENCY_TO_RISK`, which moves into the pure risk-contract module that the sink itself emits from.
- `handoffGates` -> `evidence` + `learningPhaseActive` (the captured `HandoffCampaignContext`, the exact struct the live dispatch re-checks). Absent context (account-scoped rec, signal recs, campaign not in this cycle's insight set) fails the handoff arm honestly, mirroring `buildHandoffCandidate` returning null without context.
- `revenueState` -> EXCLUDED, recorded: no live ownership gate reads it. The swipe gate reads four contract fields; the handoff gate reads allowlist + evidence + learning; the escalation tier reads riskLevel. Passing it would be a fabricated dependency (and premature abstraction).
- `governanceMode` -> EXCLUDED as NOT HONESTLY AVAILABLE at the derivation site, recorded: (i) Layer 2 cannot import core; (ii) the gate's verdict is per-request at act/submit time, not a static org property (seeded handoff policy via `policyApprovalOverride`; operator-act evaluation when the operator acts); (iii) the app seam injects no governance verdict into the audit today, and any new injection would be an org-settings snapshot, not the gate's verdict, i.e. a fabricated governance read; (iv) it currently has zero discriminating power: every mutating path from a Riley rec ends in mandatory human approval (seeded handoff policy) or IS the operator acting. Governance mode becomes the live discriminator only in Phase-C, where the permit path's verdict would justify `riley_self`; the input is reserved alongside the enum value it would unlock.
- `clientFacing` -> NOT an input: the sink hardcodes `false` for every Riley rec; pinned by the emission-parity test (Task 2), never assumed.

**D3. Enum semantics and precedence (first match wins): `mira_handoff` -> `operator_swipe` -> `human_escalation` -> `operator_approval`.** Every class names who SHOULD own the fix; no class records a consummated action (`operator_swipe` does not mean a swipe happened, `mira_handoff` does not mean a draft was submitted). This should-own framing is documented on the schema and the module.

- `mira_handoff`: Mira-owned BY GATE: the LIVE `shouldAbstainFromHandoff` clears (context present and abstain=false). NOT "submitted to Mira": surface routing (dropped), submitter wiring, and deploymentId are dispatch mechanics that do not change who should own the fix. A future `dispatchable`/`dispatchBlockReason` companion field is the recorded extension point when a consuming surface needs dispatch truth; YAGNI in this annotate-only slice.
- `operator_swipe`: the dashboard's `canSwipeApprove` predicate over `emittedRiskContractFor(action, urgency)`. This one-line predicate is the ONLY restated logic in the slice, and Task 5's tripwire makes that restatement loud (CI-fails on any drift).
- `human_escalation`: the dashboard's `needsConfirm` tier reduced to its reachable arm for Riley-emitted contracts (`riskLevel === "high"`, i.e. urgency `immediate`; `requiresConfirmation` is constant-false and the contract is always present at this site; the missing-contract arm guards legacy/non-Riley rows and is out of scope). Semantics: the live operator surface already splits handling into three tiers (swipe-commit, tap-approve, confirm-gated); ownership mirrors the confirm-gated tier as "demands deliberate, confirmed human attention now".
- `operator_approval`: the default tier.
- Exclusivity is PROVEN, not assumed: handoff-and-swipe is structurally impossible (both creative actions elevate to mutating, sweep-pinned); swipe-and-escalation is impossible (low vs high riskLevel, sweep-pinned). The only real overlap is handoff-and-escalation (an immediate-urgency creative rec clearing the gates): `mira_handoff` wins by live-behavior fidelity (the dispatch hands off regardless of urgency; the abstention reads no urgency; the parked draft IS the governed approval ceremony). Test-pinned with this rationale inline.

**D4. Spec-7.7 settled: parity tripwire, not read-the-field.** The dashboard keeps computing `canSwipeApprove`; a new dashboard test (`swipe-policy.parity.test.ts`, behind a test-only `@switchboard/ad-optimizer` devDependency) enumerates 14 actions x 3 urgencies x context variants and asserts `canSwipeApprove(emittedRiskContractFor(a, u)) === (deriveOwnership(...) === "operator_swipe")` plus the `needsConfirm`/`human_escalation` parity on the operator-owned subset. The tripwire imports ONLY pure modules through the barrel (`recommendation-risk-contract.ts`, `recommendation-ownership.ts`); the sink's operational module graph is never in the test's import path (revision-2 change). Why not read-the-field: (i) the swipe gate is generic row infrastructure serving ALL decision kinds (parked-approval conservative defaults, legacy rows where absence is unsafe, handoff cards hard-excluded upstream), so the gate must survive regardless; reading ownership for Riley rows only would SPLIT one honest path into two; (ii) the wire does not exist: ownership would have to travel RecommendationInput -> emit -> row -> decisions adapter -> Decision.meta, core+api churn for a slice whose annotation has no consumer yet; (iii) the slice-2 deferral's own trigger ("revisit when an operator surface consumes arbitration") has not fired. The tripwire makes silent divergence impossible TODAY; read-the-field stays the natural follow-up when an operator surface consumes ownership. The devDependency direction (Layer 5 dev-depends on Layer 2) is legal and build-ordered by turbo (`test` dependsOn `^build`).

**D5. `riley_self` is reserved without weakening today's wire.** Two enums in schemas: `OwnershipClassSchema` (5 values, the documented Phase-C target) and `EmittableOwnershipClassSchema` (4 values, what today's producer can emit). The report field and the derivation's return type both use the EMITTABLE schema, so the impossible state is rejected at parse time AND unrepresentable at compile time; a runtime options-equality pin keeps the two enums from drifting (`OwnershipClassSchema.options === [...EmittableOwnershipClassSchema.options, "riley_self"]`); a full-domain sweep pins the annotation builder never emits anything outside the emittable four. Phase-C's wiring session widens the report field to the 5-value enum as a deliberate, reviewed change.

**D6. One PURE producer for the emitted risk contract (revision-2 change).** A new module `packages/ad-optimizer/src/recommendation-risk-contract.ts` owns `URGENCY_TO_RISK` (moved from the sink; it was module-private with no other consumer) plus `EmittedRiskContract` and `emittedRiskContractFor(action, urgency)`. The sink IMPORTS the helper (and drops its now-unused `ACTION_CONTRACT` import); the ownership module and the dashboard tripwire import the same helper. The sink module itself is never exported as public pure API (it stays the internal emission adapter). Value-identical: the elevation now reads the contract's own `resetsLearning`, which every live producer already sets to `resetsLearningFor(action)` (the slice-2-pinned invariant, `recommendation-engine.ts:82`, `source-reallocation.ts:205`). Pinned by the existing sink tests, a new all-domain sink-vs-helper emission-parity test, the pure module's own co-located test, and eval byte-compare.

**D7. Handoff context decoupled from the submitter, without flipping the pin.** The runner builds `handoffContextByCampaign` UNCONDITIONALLY (runner-internal; one pure `handoffContextFromInsight` call per campaign, no Graph calls), but passes it to the sink ONLY alongside a submitter, exactly as today. The sink-visible contract stays byte-identical and `audit-runner-handoff.test.ts:191` stands unflipped. Ownership reads the always-built map, so the classification is identical whether or not the Mira wire is configured (ownership describes who SHOULD own the fix, not the org's wiring).

**D8. Parity claims are scoped to Riley emitted contracts.** The tripwire and the escalation semantics assert parity over `emittedRiskContractFor(...)` outputs, i.e. the contracts Riley actually emits. The dashboard gates' other arms (missing contract => unsafe/confirm) guard legacy and non-Riley rows and are deliberately outside this slice's parity claims.

## Baselines recorded (base SHA `7865b68f`)

- `pnpm typecheck` green; `pnpm build` green.
- Suites green: schemas, ad-optimizer, core; api 1554 passed / 4 skipped; db red ONLY in the known trio (9 failures: work-trace-integrity 6, ledger 2, greeting 1).
- `eval:riley` 12+10+6 green, saved at `/tmp/dob-baselines/eval-riley.baseline.txt`; `eval:governance` 26 green, saved at `/tmp/dob-baselines/eval-governance.baseline.txt`.
- `eval:alex-conversation` env-blocked (no `ANTHROPIC_API_KEY` in shell; skips gracefully off main).

---

### Task 0: Commit this plan

**Files:**

- Create: `docs/superpowers/plans/2026-06-05-riley-v3-derive-ownership.md` (this file)

- [ ] **Step 0.1:** Commit the plan (the slice-2/4c convention: the plan doc lands in the implementation PR). Revision 1 was committed at `a928fa4c`; commit revision 2:

```bash
git add docs/superpowers/plans/2026-06-05-riley-v3-derive-ownership.md
git commit -m "docs(plans): revise deriveOwnership plan per review (pure module, emittable wire)"
```

---

### Task 1: Schemas: `OwnershipClassSchema` + `EmittableOwnershipClassSchema` + report-level `ownership` field

**Files:**

- Modify: `packages/schemas/src/ad-optimizer.ts` (enums near the top constants; field after `arbitration`)
- Test: `packages/schemas/src/ad-optimizer.test.ts`

- [ ] **Step 1.1: Write the failing tests.** Append to `packages/schemas/src/ad-optimizer.test.ts` (the existing `baseReport` lives inside the campaignEconomics describe, so this block declares its own local copy). Add `OwnershipClassSchema` and `EmittableOwnershipClassSchema` to the file's import list from `./ad-optimizer.js`:

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

  it("REJECTS riley_self on today's report wire (Phase-C widens this deliberately)", () => {
    expect(() =>
      AuditReportSchema.parse({
        ...baseReport,
        ownership: [{ campaignId: "c1", action: "pause", index: 0, ownership: "riley_self" }],
      }),
    ).toThrow();
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

  it("pins the two enums against drift: reserved = emittable + riley_self", () => {
    expect(OwnershipClassSchema.options).toEqual([
      ...EmittableOwnershipClassSchema.options,
      "riley_self",
    ]);
    expect(EmittableOwnershipClassSchema.options).toEqual([
      "operator_swipe",
      "operator_approval",
      "mira_handoff",
      "human_escalation",
    ]);
  });
});
```

- [ ] **Step 1.2: Run to verify failure.**

Run: `pnpm --filter @switchboard/schemas test`
Expected: FAIL (`OwnershipClassSchema` / `EmittableOwnershipClassSchema` not exported).

- [ ] **Step 1.3: Implement.** In `packages/schemas/src/ad-optimizer.ts`, after the `UrgencySchema` block (`:34-35`), add:

```ts
// Riley v3 (spec 2.2 net-new item 1): who SHOULD own the fix for a recommendation.
// Every class is a should-own classification, not a record of consummated action
// (operator_swipe does not mean a swipe happened; mira_handoff means "Mira-owned
// by the live handoff gate", NOT "a draft was submitted to Mira": surface routing,
// submitter wiring, and deployment resolution are dispatch mechanics annotated
// elsewhere when a consumer needs them).
//
// EmittableOwnershipClassSchema is what today's advisory derivation can produce
// and what the report wire accepts. OwnershipClassSchema additionally reserves
// riley_self as the documented Phase-C target (the governed permit path); the
// Phase-C wiring session widens the report field to it deliberately. A test pins
// reserved = emittable + riley_self so the two cannot drift.
export const EmittableOwnershipClassSchema = z.enum([
  "operator_swipe",
  "operator_approval",
  "mira_handoff",
  "human_escalation",
]);
export type EmittableOwnershipClassSchema = z.infer<typeof EmittableOwnershipClassSchema>;

export const OwnershipClassSchema = z.enum([
  ...EmittableOwnershipClassSchema.options,
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
  // campaignId+action are carried for human legibility. The EMITTABLE enum is
  // deliberate: today's wire rejects riley_self (see OwnershipClassSchema).
  ownership: z
    .array(
      z.object({
        campaignId: z.string(),
        action: AdRecommendationActionSchema,
        index: z.number().int().nonnegative(),
        ownership: EmittableOwnershipClassSchema,
      }),
    )
    .optional(),
```

- [ ] **Step 1.4: Run to verify pass.**

Run: `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/schemas build && pnpm typecheck`
Expected: PASS (build schemas first so dependents see the new exports; typecheck green).

- [ ] **Step 1.5: Commit.**

```bash
git add packages/schemas/src/ad-optimizer.ts packages/schemas/src/ad-optimizer.test.ts
git commit -m "feat(schemas): ownership annotation on the audit report (riley_self type-reserved)"
```

---

### Task 2: New pure module `recommendation-risk-contract.ts` + sink re-point

**Files:**

- Create: `packages/ad-optimizer/src/recommendation-risk-contract.ts`
- Create: `packages/ad-optimizer/src/recommendation-risk-contract.test.ts`
- Modify: `packages/ad-optimizer/src/recommendation-sink.ts` (delete the module-private `URGENCY_TO_RISK`; drop the `ACTION_CONTRACT` import; re-point the per-rec field computation)
- Test: `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts` (append the sink-vs-helper parity test)

- [ ] **Step 2.1: Write the failing tests.** Create `packages/ad-optimizer/src/recommendation-risk-contract.test.ts` (the pure module's own pins):

```ts
import { describe, expect, it } from "vitest";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import { emittedRiskContractFor, URGENCY_TO_RISK } from "./recommendation-risk-contract.js";
import { ACTION_CONTRACT } from "./action-contract.js";

describe("recommendation-risk-contract (the single five-field producer)", () => {
  it("maps urgency to riskLevel exactly as the v1 router contract expects", () => {
    expect(URGENCY_TO_RISK).toEqual({ immediate: "high", this_week: "medium", next_cycle: "low" });
  });

  it("pins the constants the dashboard gate relies on: clientFacing and requiresConfirmation are always false", () => {
    for (const action of AdRecommendationActionSchema.options) {
      for (const urgency of UrgencySchema.options) {
        const c = emittedRiskContractFor(action, urgency);
        expect(c.clientFacing).toBe(false);
        expect(c.requiresConfirmation).toBe(false);
        expect(c.riskLevel).toBe(URGENCY_TO_RISK[urgency]);
        expect(c.financialEffect).toBe(ACTION_CONTRACT[action].financialEffect);
      }
    }
  });

  it("bakes the learning-reset elevation (both static-false creative actions are externally effecting)", () => {
    expect(emittedRiskContractFor("refresh_creative", "next_cycle").externalEffect).toBe(true);
    expect(emittedRiskContractFor("add_creative", "next_cycle").externalEffect).toBe(true);
    expect(emittedRiskContractFor("hold", "next_cycle").externalEffect).toBe(false);
    expect(emittedRiskContractFor("pause", "next_cycle").externalEffect).toBe(true);
  });
});
```

Append to `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts` (merge the new import into the file's existing top-of-file import block, never mid-file):

```ts
import { emittedRiskContractFor } from "../recommendation-risk-contract.js";
import { UrgencySchema } from "@switchboard/schemas";

describe("sink emission parity with emittedRiskContractFor (Riley v3 ownership)", () => {
  it("the sink's emitted risk-contract fields match the pure producer for every action x urgency", async () => {
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
        expect(
          {
            riskLevel: emitted.riskLevel,
            financialEffect: emitted.financialEffect,
            externalEffect: emitted.externalEffect,
            clientFacing: emitted.clientFacing,
            requiresConfirmation: emitted.requiresConfirmation,
          },
          `${action}/${urgency}`,
        ).toEqual(emittedRiskContractFor(action, urgency));
      }
    }
  });
});
```

(`baseRec` sets `resetsLearning: resetsLearningFor(action)`, which is how every live producer builds recs; the helper reads the contract's own class, the slice-2-pinned single source.)

- [ ] **Step 2.2: Run to verify failure.**

Run: `pnpm --filter @switchboard/ad-optimizer test -- recommendation-risk-contract`
Expected: FAIL (module does not exist).

- [ ] **Step 2.3: Implement.**

(a) Create `packages/ad-optimizer/src/recommendation-risk-contract.ts`:

```ts
import type {
  AdRecommendationActionSchema as AdRecommendationAction,
  UrgencySchema as Urgency,
} from "@switchboard/schemas";
import { ACTION_CONTRACT } from "./action-contract.js";

/**
 * Riley v3 (spec 2.2): the single PURE producer of the five risk-contract fields
 * a Riley recommendation emits. The sink (emission), the ownership derivation
 * (recommendation-ownership.ts), and the dashboard swipe-policy parity tripwire
 * (apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts) all
 * read THIS module, so the emitted shape can never fork. Deliberately free of
 * emission machinery: this module is part of the package's public pure API; the
 * sink is not.
 */

/**
 * Map ad-optimizer urgency (immediate / this_week / next_cycle) to the
 * Recommendation riskLevel enum (low / medium / high) used by the core router.
 * Urgency reflects "how soon should this be acted on": that aligns with risk
 * for the v1 router (high-urgency items are time-sensitive financial signals).
 * Moved here from recommendation-sink.ts (it was module-private there).
 */
export const URGENCY_TO_RISK: Record<Urgency, "low" | "medium" | "high"> = {
  immediate: "high",
  this_week: "medium",
  next_cycle: "low",
};

/**
 * INVARIANT (Phase-A spec section 5/7): a learning-resetting action is a
 * material, hard-to-undo change even when no dollars move, so externalEffect
 * bakes the elevation (resetsLearning === "yes" forces it true; the router
 * treats externalEffect=true as "not swipe-approvable"). Riley does not message
 * clients (clientFacing always false) and riskLevel drives the UI confirm step
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
  action: AdRecommendationAction,
  urgency: Urgency,
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

(b) In `packages/ad-optimizer/src/recommendation-sink.ts`:

- Delete the module-private `URGENCY_TO_RISK` const (`:119-123`) and its doc comment; keep `URGENCY_TO_EXPIRY_HOURS` (expiry is emission mechanics).
- Drop the `ACTION_CONTRACT` import (`:9`; its only use is replaced below) and add `import { emittedRiskContractFor } from "./recommendation-risk-contract.js";`.
- Update the orphaned comment block at `:136-140` ("Risk-contract flags now live on...") to point at the new module: `// Risk-contract fields are produced by emittedRiskContractFor (recommendation-risk-contract.ts), the single producer shared with the ownership derivation and the dashboard parity tripwire.`
- In the emission loop, replace the inline computation (`const contract = ACTION_CONTRACT[rec.action];` plus the `financialEffect`/`externalEffect` consts and their INVARIANT comment, `:419-424`) with:

```ts
const riskContract = emittedRiskContractFor(rec.action, rec.urgency);
```

- In the emit input object, replace the five fields (`riskLevel: URGENCY_TO_RISK[rec.urgency]`, `financialEffect`, `externalEffect`, `clientFacing: false`, `requiresConfirmation: false`) with:

```ts
        riskLevel: riskContract.riskLevel,
        financialEffect: riskContract.financialEffect,
        externalEffect: riskContract.externalEffect,
        clientFacing: riskContract.clientFacing,
        requiresConfirmation: riskContract.requiresConfirmation,
```

Note: the elevation source changes from `rec.resetsLearning` to the contract's own class. Every live producer sets `rec.resetsLearning = resetsLearningFor(action)` (slice-2-pinned invariant), so this is value-identical on the reachable domain; the action is the single source of truth for the class (the slice-2 consolidation's whole point).

- [ ] **Step 2.4: Run to verify pass + eval byte-compare.**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley > /tmp/dob-baselines/eval-riley.task2.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.task2.txt && echo BYTE-UNCHANGED`
Expected: suite PASS (existing sink tests green unchanged); `BYTE-UNCHANGED`.

- [ ] **Step 2.5: Commit.**

```bash
git add packages/ad-optimizer/src/recommendation-risk-contract.ts packages/ad-optimizer/src/recommendation-risk-contract.test.ts packages/ad-optimizer/src/recommendation-sink.ts packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts
git commit -m "refactor(ad-optimizer): move the emitted risk contract into one pure producer module"
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
import { emittedRiskContractFor } from "./recommendation-risk-contract.js";
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
  EmittableOwnershipClassSchema as EmittableOwnershipClass,
  RecommendationOutputSchema as RecommendationOutput,
  UrgencySchema as Urgency,
} from "@switchboard/schemas";
import { emittedRiskContractFor } from "./recommendation-risk-contract.js";
import { shouldAbstainFromHandoff } from "./recommendation-handoff-abstention.js";
import type { HandoffCampaignContext } from "./recommendation-handoff-dispatch.js";

/**
 * Riley v3 (spec 2.2 net-new item 1): ownership as ONE derivation instead of five
 * scattered fragments. Classifies who SHOULD own the fix for a recommendation;
 * no class records a consummated action (operator_swipe does not mean a swipe
 * happened; mira_handoff means "Mira-owned by the live handoff gate", NOT
 * "submitted to Mira": surface routing, submitter wiring, and deploymentId are
 * dispatch mechanics, annotated elsewhere when a consumer needs dispatch truth).
 *
 *   mira_handoff      the LIVE handoff abstention clears (allowlist -> evidence
 *                     floor -> learning lock; the same shouldAbstainFromHandoff
 *                     the dispatch runs, called directly, never re-implemented)
 *   operator_swipe    the dashboard's canSwipeApprove predicate over the emitted
 *                     risk contract (cross-package parity tripwire:
 *                     apps/dashboard .../swipe-policy.parity.test.ts)
 *   human_escalation  the dashboard's needsConfirm tier reduced to its reachable
 *                     arm for Riley emitted contracts (riskLevel high;
 *                     requiresConfirmation is constant-false and the contract is
 *                     always present at this site; the missing-contract arm
 *                     guards legacy/non-Riley rows, out of scope here)
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
 * only in Phase-C, reserved alongside riley_self (which today's report wire
 * rejects; see EmittableOwnershipClassSchema).
 *
 * Ownership ANNOTATES; it gates nothing.
 */

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

- [ ] **Step 3.4: Barrel exports.** In `packages/ad-optimizer/src/index.ts`, after the slice-2 arbitrator export block, add (pure modules ONLY; the sink stays internal, `deriveOwnershipAnnotations` stays runner-internal):

```ts
// Riley v3 (spec 2.2): the ownership derivation and the single five-field
// emitted-risk-contract producer (both PURE modules; the dashboard parity
// tripwire and any future operator surface consume these through the barrel).
// deriveOwnershipAnnotations stays package-internal (only the audit runner
// builds the report annotation); the sink module is never public API.
export { deriveOwnership } from "./recommendation-ownership.js";
export type { DeriveOwnershipInput, OwnershipAnnotation } from "./recommendation-ownership.js";
export { emittedRiskContractFor, URGENCY_TO_RISK } from "./recommendation-risk-contract.js";
export type { EmittedRiskContract } from "./recommendation-risk-contract.js";
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
- Test: `packages/ad-optimizer/src/__tests__/audit-runner-ownership.test.ts` (new: lean wiring pins)
- Test: `packages/ad-optimizer/src/__tests__/audit-runner-ownership-handoff.test.ts` (new: ONE end-to-end semantic pin)

The runner tests are split into two focused files (revision-2 change) so a failure localizes: file 1 pins the wiring (totality, fidelity, additivity, aborts) on the SIMPLE single-campaign breach fixture; file 2 pins the one semantic flow that needs a richer fixture (fatigue campaign -> refresh_creative -> context plumbed -> mira_handoff).

- [ ] **Step 4.1: Write the failing wiring tests.** Create `packages/ad-optimizer/src/__tests__/audit-runner-ownership.test.ts`. The fixture builders (`makeCampaignInsight`, `makeAccountSummary`, `makeFunnelData`, `makeCrmBenchmarks`, `makeMediaBenchmarks`, `makeLearningInput`, `makeBreachingTargetBreach`, `buildDeps`, `RANGE`) are copied VERBATIM from `audit-runner-arbitration.test.ts:27-150` (each test file owns its builders per the existing convention); the signal-red `makeReport` fixture is copied from `audit-runner.test.ts` (`signal-health pre-check` describe, ~`:498-532`). The single-campaign breach fixture produces only mutating recs (its insight defaults hold CTR/frequency flat, so no creative_fatigue fires and no `mira_handoff` appears in this file; that class is file 2's job). New test content after the transplanted builders:

```ts
import { emittedRiskContractFor } from "../recommendation-risk-contract.js";

// Riley v3 (spec 2.2 net-new item 1): the ownership annotation is ADDITIVE
// metadata over recommendations[]. This file pins the WIRING: total,
// index-faithful, tier-correct annotation; present without emitter/submitter;
// emission payloads unchanged; absent on both abort reports. The end-to-end
// mira_handoff semantic pin lives in audit-runner-ownership-handoff.test.ts.
// The sink-side context pin (audit-runner-handoff.test.ts:191) stays UNFLIPPED
// and that file UNMODIFIED.

const EMITTABLE = ["operator_swipe", "operator_approval", "mira_handoff", "human_escalation"];

describe("audit-runner ownership annotation (wiring)", () => {
  it("annotates every recommendation, index-faithful and tier-correct", async () => {
    const runner = new AuditRunner(buildDeps());
    const report = await runner.run(RANGE);

    // The breaching fixture must produce candidates or this test pins nothing.
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
      // deriveOwnership: this pins the runner wired urgency + action correctly).
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
  });

  it("derives ownership with NO emitter and NO submitter (annotation independent of the Mira wire)", async () => {
    const runner = new AuditRunner(buildDeps()); // analysis-only deps
    const report = await runner.run(RANGE);
    expect(report.ownership).toBeDefined();
    expect(report.ownership?.length).toBe(report.recommendations.length);
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

- [ ] **Step 4.2: Write the failing end-to-end handoff pin.** Create `packages/ad-optimizer/src/__tests__/audit-runner-ownership-handoff.test.ts`. Same transplanted builders as Step 4.1 (verbatim copies; this file additionally defines the fatigue-campaign insights and a per-campaign breach mock):

```ts
// Riley v3: ONE semantic end-to-end pin. A fatigued campaign produces
// refresh_creative and resolves to mira_handoff, proving the evidence flowed
// from the window insight (clicks/conversions/windowDays) through the
// runner-internal context map into the LIVE abstention gate, with and without
// a submitter wired.

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

function buildTwoCampaignDeps(): AuditDependencies {
  const deps = buildDeps();
  deps.adsClient.getCampaignInsights = vi
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
    ]);
  // camp-1 durably breaches; camp-2 does not (its recs stay purely
  // fatigue-driven so this pin is deterministic).
  deps.insightsProvider.getTargetBreachStatus = vi
    .fn()
    .mockImplementation((args: { campaignId: string }) =>
      Promise.resolve(
        args.campaignId === "camp-1"
          ? makeBreachingTargetBreach()
          : { periodsAboveTarget: 0, granularity: "daily", isApproximate: false },
      ),
    );
  return deps;
}

describe("audit-runner ownership: end-to-end mira_handoff plumbing", () => {
  it("a fatigued campaign's refresh_creative resolves mira_handoff, submitter or not", async () => {
    for (const withSubmitter of [false, true]) {
      const deps = buildTwoCampaignDeps();
      const runner = new AuditRunner(
        withSubmitter
          ? {
              ...deps,
              recommendationEmitter: vi.fn(async () => ({
                surface: "queue" as const,
                id: "rec-1",
              })),
              recommendationEmissionContext: { cronId: "cron-test", deploymentId: "dep-1" },
              recommendationHandoffSubmitter: vi.fn(async () => undefined),
            }
          : deps,
      );
      const report = await runner.run(RANGE);
      const creativeIdx = report.recommendations.findIndex(
        (r) => r.action === "refresh_creative" && r.campaignId === "camp-2",
      );
      // Hard pin: the fatigue fixture MUST produce the creative rec; if the
      // diagnosis stops firing, fix the fixture against metric-diagnostician
      // RULES, never weaken this assertion.
      expect(creativeIdx, `submitter=${withSubmitter}`).toBeGreaterThanOrEqual(0);
      expect(report.ownership?.[creativeIdx]?.ownership).toBe("mira_handoff");
    }
  });
});
```

- [ ] **Step 4.3: Run to verify failure.**

Run: `pnpm --filter @switchboard/ad-optimizer test -- audit-runner-ownership`
Expected: FAIL in both files (`report.ownership` undefined).

- [ ] **Step 4.4: Implement.** In `packages/ad-optimizer/src/audit-runner.ts`:

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

- [ ] **Step 4.5: Run to verify pass + the unflipped pin + eval byte-compare.**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/ad-optimizer build && pnpm eval:riley > /tmp/dob-baselines/eval-riley.task4.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.task4.txt && echo BYTE-UNCHANGED`
Expected: full ad-optimizer suite PASS (including `audit-runner-handoff.test.ts` UNMODIFIED and green); `BYTE-UNCHANGED`.

- [ ] **Step 4.6: Commit.**

```bash
git add packages/ad-optimizer/src/audit-runner.ts packages/ad-optimizer/src/__tests__/audit-runner-ownership.test.ts packages/ad-optimizer/src/__tests__/audit-runner-ownership-handoff.test.ts
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

- [ ] **Step 5.2: Write the test** (it imports ONLY the pure modules through the barrel: deriveOwnership + emittedRiskContractFor; the sink's operational module graph is not in the import path). Create `apps/dashboard/src/lib/decisions/__tests__/swipe-policy.parity.test.ts` (dashboard imports omit `.js`):

```ts
import { describe, expect, it } from "vitest";
import { deriveOwnership, emittedRiskContractFor } from "@switchboard/ad-optimizer";
import { AdRecommendationActionSchema, UrgencySchema } from "@switchboard/schemas";
import { canSwipeApprove, needsConfirm } from "../swipe-policy";

/**
 * Riley v3 spec-7.7 parity tripwire. The dashboard keeps its generic
 * risk-contract gate (it serves parked approvals, legacy rows, and any future
 * producer), and the backend's deriveOwnership restates the swipe predicate
 * once. This test makes that restatement IMPOSSIBLE TO DRIFT SILENTLY: it
 * enumerates the full action x urgency domain against the SAME five-field
 * contract the sink emits (emittedRiskContractFor is the sink's own producer)
 * and fails CI when either side moves (a new action, a changed elevation, an
 * URGENCY_TO_RISK change, or a swipe-policy edit).
 *
 * SCOPE (Riley emitted-contract parity): these assertions hold over the
 * contracts Riley emits. The gates' missing-contract arms (absence = unsafe /
 * confirm) guard legacy and non-Riley rows and are deliberately out of scope.
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
grep -n "ownership" packages/ad-optimizer/src/recommendation-sink.ts ; echo "exit $? (expect 1: the sink never reads ownership)"
```

Expected: no `PlatformIngress` in the ad-optimizer diff; zero diff in core/db/api/chat; the sink does not reference ownership (emission unchanged by construction).

- [ ] **Step 6.4: Pre-push gates.**

```bash
pnpm format:check
pnpm arch:check
cd .agent/tools && CI=1 pnpm exec tsx check-routes.ts --mode=error; cd ../..
```

Expected: all green (`audit-runner.ts` stays warn-tier behind its existing eslint-disable; no route changes).

---

### Task 7: Rebase, PR, auto-merge, post-merge verify, teardown

- [ ] **Step 7.1:** `git fetch origin main && git rebase origin/main` then re-run: `pnpm build && pnpm typecheck && pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/dashboard test && pnpm eval:riley > /tmp/dob-baselines/eval-riley.rebased.txt 2>&1; diff /tmp/dob-baselines/eval-riley.baseline.txt /tmp/dob-baselines/eval-riley.rebased.txt`. If main moved under the touched files, re-derive anchors before resolving.

- [ ] **Step 7.2:** Push and open ONE focused PR:

- Title: `feat(ad-optimizer,schemas,dashboard): riley v3 deriveOwnership consolidation`
- Body: design decisions D1-D8 summary (wire placement over the EMITTABLE enum + eval-safety proof, the honest input set incl. the governance non-availability record and the revenueState exclusion, precedence + exclusivity proofs + the should-own semantics note, the spec-7.7 tripwire defense incl. pure-modules-only imports, the riley_self reservation incl. parse-time rejection today, the pure single-producer extraction, the unflipped sink-contract pin, the Riley emitted-contract parity scope); scope-fence grep outputs; eval byte-unchanged records incl. the alex-eval env blocker; known-noise notes (db trio, CI flakes, Eval Claim Classifier).

- [ ] **Step 7.3:** `gh pr merge --squash --auto`. Watch required CI; on flake (api-auth prod-hardening, chat gateway-bridge-attribution, bootstrap-smoke npm-warn) rerun before investigating. NEVER `--delete-branch` while any stacked work exists (none planned here).

- [ ] **Step 7.4:** Post-merge: verify the first NON-CANCELLED completed main run containing the squash (the merge train cancels superseded runs; cancelled is not failure; Eval Claim Classifier failure is the known broken secret, not this PR).

- [ ] **Step 7.5:** Same-day teardown: `git worktree remove <path> && git worktree prune`; delete the branch local + remote. Update memory: deriveOwnership shipped; remaining Riley-v3 decision point = slice 5 Phase-C seam when Riley earns execution, plus the optional 4d corroborated / 4e late-interval arms; spec-7.7 revisit-trigger = an operator surface consuming ownership/arbitration (then read-the-field becomes the natural follow-up, alongside the recorded `dispatchable`/`dispatchBlockReason` extension point); Phase-C widens the report's ownership field to the 5-value enum deliberately.

---

## Self-review (spec/prompt coverage)

- Spec 2.2 net-new item 1 (the five scattered inputs -> one derivation): Tasks 2-4 (the derivation + the single pure five-field producer + the report annotation). Each input's live producer re-derived: swipe gate (Task 5 tripwire), URGENCY_TO_RISK + clientFacing-false (Task 2 pins), handoff gate (direct `shouldAbstainFromHandoff` reuse, Task 3), governance mode (recorded NOT honestly available, D2), revenueState (recorded not-an-input, D2).
- Spec 2.3 (static-vs-elevated trap): `emittedRiskContractFor` bakes the elevation from the consolidated contract; Task 2 pins both static-false-but-elevated creative actions.
- Spec 7.7 (no silent duplication): D4 settled as tripwire; Task 5 makes drift CI-fatal; read-the-field revisit-trigger recorded.
- Prompt "exact enum settled": D3 (operator_swipe | operator_approval | mira_handoff | human_escalation; riley_self reserved per D5 with parse-time rejection today).
- Prompt "parity proofs against LIVE logic, never re-implementations": handoff arm calls the live gate; swipe/escalation arms read the same pure producer the sink emits from; the one restated predicate is tripwired cross-package against the live `canSwipeApprove`/`needsConfirm` (scope per D8).
- Prompt "precedence ... deterministic, test-pinned": D3 + Task 3 sweeps + the explicit handoff-over-escalation pin.
- Prompt scope fence: Task 6.3 greps (advisory-only, zero core/db/api/chat diff, emission/handoff/arbitration untouched); dashboard change is test-only (the settled-tripwire arm of the allowed dashboard scope).
- Prompt gates: per-task suite runs + eval byte-compare after every behavior-bearing task (2, 3, 4, final), full matrix in Task 6, pre-push gates 6.4, rebase + re-gate 7.1.
- Eval-sensitivity (12+10+6 pins): no `RecommendationOutputSchema` change; report-level optional field; harness structurally blind (anchor) + byte-compare proof at every step.
- Plan-review items: (1) pure module extraction -> D6 + Task 2; (2) emittable wire -> D5 + Task 1; (3) should-own semantics documented -> D3 + the schema/module comments; (4) tripwire purity -> D4 + Task 5; (5) runner test split -> Task 4 (two files); (6) parity scope -> D8 + the tripwire's SCOPE comment.
