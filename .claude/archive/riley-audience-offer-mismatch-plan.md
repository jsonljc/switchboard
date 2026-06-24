# audience_offer_mismatch watch — TDD implementation plan (ephemeral .claude scratch)

> Worktree: .claude/worktrees/riley-audience-offer-mismatch (branch feat/riley-audience-offer-mismatch-watch off origin/main @ ebd58b252)
> Mirrors breach_building (#998 = 849a81ecf). Read-only perception watch; no governance/money/schema-migration.

**Goal:** Surface the high-confidence `audience_offer_mismatch` diagnosis ("strong clicks but low conversions")
as an informational `WatchOutput` on the deterministic weekly audit — but ONLY when it would otherwise be pure
silence (no rec, no burn, no breach_building). Document the deliberate non-surfacing of `competition_increase`
(informational/noise) and `account_level_issue` (low-confidence + cpl===cpa double-count) with marker comments.

**Architecture:** New pure watch constructor in recommendation-engine.ts; gated at the return assembly site on
`withBreach.length === 0 && hasDiagnosis(diagnoses, "audience_offer_mismatch")` (booleans only → no NaN-blind
risk). Flows generically via campaign-decision.ts:213 watch passthrough -> audit-runner.ts:662 -> AuditReport.

## Global Constraints (verbatim)

- ESM, .js ext in relative imports; no `any`; no console.log; prettier semi/double-quote/2-space/trailing/100w.
- Number.isFinite-guard every external numeric (#939). (N/A here — gating is boolean-only; note it explicitly.)
- Co-located \*.test.ts. Lowercase conventional-commit subject, no em-dashes. arch:check err >600 lines (raw .ts).
- eval:riley is REQUIRED (touches the decision engine): extend with a fixture + drift-guard line; never regress 24+10+6.

## File map

- ARCH CONSTRAINT: recommendation-engine.ts is 599 lines; arch:check ERRORS at >600 (scripts/arch-check.ts
  ERROR_LINES=600, lines>600, counts all lines; eslint-disable escape hatch = legacy-debt, do NOT use). So the
  slice MUST net-reduce the engine. Fix: extract the PURE watch constructors to a sibling module.
- Create: packages/ad-optimizer/src/recommendation-watches.ts (move insufficientEvidenceWatch [pure, no engine-const
  deps] + add new audienceOfferMismatchWatch). Engine: 599 - ~22 (move out) + ~9 (import + gate) = ~586. Under 600.
- Create: packages/ad-optimizer/src/**tests**/recommendation-watches.test.ts (co-located, new module rule)
- Modify: packages/ad-optimizer/src/recommendation-engine.ts (import both from watches module + return-site gate)
- Modify: packages/ad-optimizer/src/**tests**/recommendation-engine.test.ts (emit + suppression + exclusion guards)
- Modify: packages/ad-optimizer/src/metric-diagnostician.ts (marker comments for the 2 excluded diagnoses; NO behavior change)
- Create: evals/riley-recommendation/fixtures/audience-offer-mismatch.jsonl (1 positive end-to-end case)
- Modify: evals/riley-recommendation/**tests**/drift-guard.test.ts (+1 assertion after the breach_building line)
- Modify: evals/riley-recommendation/README.md (+1 coverage row)

---

### Task 0: Baseline (pre-change green)

- [ ] grep recommendation-engine.test.ts + all eval fixtures for any existing case feeding `audience_offer_mismatch`
      with empty/`none` expected output — a case that my change would flip. If found, reconcile before proceeding.
- [ ] Run `pnpm --filter @switchboard/ad-optimizer test` and `pnpm eval:riley` on the clean branch -> confirm GREEN baseline.

### Task 1: Watch constructor + return-site gate (co-located TDD)

**Interfaces produced:** `audience_offer_mismatch` WatchOutput appended by generateRecommendations only in pure silence.

- [ ] **Step 1 (RED): tests** in recommendation-engine.test.ts, new describe block. Cases:
  - emits an `audience_offer_mismatch` watch when the diagnosis is present and NO rec/burn/breach fired
    (diagnoses:[{pattern:"audience_offer_mismatch",confidence:"high",description:"Strong clicks but low conversions"}],
    deltas with cpa present but < 2x target, targetBreach daily periodsAboveTarget low, evidence conversions>0).
  - the watch's pattern==="audience_offer_mismatch", type==="watch", checkBackDate==="" (caller fills).
  - SUPPRESSED when a destructive rec fired: same diagnosis but cpa>2x target + daily periodsAboveTarget>=7
    (add_creative/pause present) -> output contains NO audience_offer_mismatch watch.
  - SUPPRESSED when landing_page_drop hold fired: include diagnoses landing_page_drop + audience_offer_mismatch
    with the inputs that make hold fire -> no audience watch.
  - SUPPRESSED when breach_building fired: cpa>2x, daily periodsAboveTarget 1..6 -> breach_building present, no audience watch.
  - SUPPRESSED when burn fired: evidence.conversions===0, spend>=50, clicks>=floor -> burn present, no audience watch.
  - NO watch when the diagnosis is absent (e.g. diagnoses:[] ) even in pure silence.
- [ ] **Step 2 (RED proof):** `pnpm --filter @switchboard/ad-optimizer test recommendation-engine` -> FAIL on the
      emit assertion (no audience_offer_mismatch in output). Capture the failing excerpt.
- [ ] **Step 3 (GREEN): implement.** In recommendation-engine.ts add the pure constructor + gate at the return:

```ts
function audienceOfferMismatchWatch(
  base: Pick<RecommendationInput, "campaignId" | "campaignName">,
): WatchOutput {
  return {
    type: "watch",
    campaignId: base.campaignId,
    campaignName: base.campaignName,
    pattern: "audience_offer_mismatch",
    message:
      "Strong clicks but conversions are not keeping pace — the audience or offer may be mismatched. Watching before any action; review landing page, offer, and audience fit.",
    checkBackDate: "",
  };
}
```

and replace the final return:

```ts
const withBurn = burn ? [burn, ...floored] : floored;
const withBreach = breachBuilding ? [...withBurn, breachBuilding] : withBurn;
// audience_offer_mismatch (D1-3 visibility): "strong clicks but low conversions" fires (high
// confidence) on the deterministic seam but no rec branch consumes it, so today it is computed
// and discarded. Surface it as an INFORMATIONAL watch ONLY when it would otherwise be pure silence
// (withBreach empty == no rec/evidence-floor watch, no burn, no breach_building). Any of those is a
// stronger, more specific signal for this campaign; piling an advisory on top would be noise. Gating
// keys off the boolean diagnosis + array-emptiness ALONE (no new numeric comparison), so it carries
// no NaN-blind-gate risk (#939) — cpa/ctr robustness lives in the diagnostician. Purely additive:
// changes no existing rec/watch/insight outcome. checkBackDate left blank for campaign-decision.ts.
const audienceWatch =
  withBreach.length === 0 && hasDiagnosis(diagnoses, "audience_offer_mismatch")
    ? audienceOfferMismatchWatch(base)
    : null;
return audienceWatch ? [audienceWatch] : withBreach;
```

- [ ] **Step 4 (GREEN proof):** rerun the filter test -> PASS. Then full `pnpm --filter @switchboard/ad-optimizer test` -> PASS.
- [ ] **Step 5: commit** `feat(ad-optimizer): surface audience_offer_mismatch as an informational watch`

### Task 2: Eval fixture + drift-guard + README (eval-pinned end-to-end)

- [ ] **Step 1 (RED): drift-guard assertion** in drift-guard.test.ts, after the breach_building line (~:72):

```ts
expect(watchPatterns.has("audience_offer_mismatch")).toBe(true); // D1-3 strong-clicks-low-conversions visibility
```

- [ ] **Step 2 (RED proof):** `pnpm eval:riley` drift-guard -> FAIL (pattern not observed across fixtures yet).
- [ ] **Step 3 (GREEN): fixture** evals/riley-recommendation/fixtures/audience-offer-mismatch.jsonl. One case,
      verified numbers (prev impr20000/clk400/spend4000/conv50; curr impr20000/clk600/spend4000/conv25 ->
      cpm flat-stable, ctr 2.0->3.0 up-sig, cpa 80->160 up-sig 1.6x; only audience_offer_mismatch fires; results empty):

```jsonl
{
  "id": "audience-offer-mismatch-pure-silence",
  "current": {
    "impressions": 20000,
    "inlineLinkClicks": 600,
    "spend": 4000,
    "conversions": 25,
    "revenue": 0,
    "frequency": 1.5
  },
  "previous": {
    "impressions": 20000,
    "inlineLinkClicks": 400,
    "spend": 4000,
    "conversions": 50,
    "revenue": 0,
    "frequency": 1.5
  },
  "targetBreach": {
    "periodsAboveTarget": 3,
    "granularity": "daily"
  },
  "learningState": "success",
  "economicTier": "booked_cac",
  "effectiveTarget": 100,
  "targetROAS": 3,
  "expectedOutcome": "watch",
  "expectedWatchPatterns": [
    "audience_offer_mismatch"
  ],
  "notes": "..."
}
```

      (Prepend explanatory comment lines, mirroring breach-building.jsonl. Confirm the exact fixture field shape against schema.ts at EXECUTE.)

- [ ] **Step 4 (GREEN proof):** `pnpm eval:riley` -> PASS (new case asserts the watch; drift-guard green; existing 24+10+6 unchanged).
- [ ] **Step 5: README coverage row** in evals/riley-recommendation/README.md (mirror the breach_building row).
- [ ] **Step 6: commit** `test(ad-optimizer): pin audience_offer_mismatch watch with an eval fixture + drift guard`

### Task 3: Marker comments for the deliberately-excluded diagnoses (doc + guard)

- [ ] **Step 1 (guard tests)** in recommendation-engine.test.ts: a `competition_increase`-only diagnosis in pure
      silence yields NO watch; an `account_level_issue`-only diagnosis in pure silence yields NO watch. (Pins the
      deliberate non-surfacing; passes before+after — a regression guard, not a feature driver.)
- [ ] **Step 2: marker comments** in metric-diagnostician.ts before the competition_increase rule (:54) and the
      account_level_issue rule (:157), in the #1135 style, documenting WHY each is computed but not surfaced on the
      deterministic audit (informational/noise; low-confidence + cpl===cpa double-count → misleading "all metrics"
      copy), and that audience_offer_mismatch IS surfaced. NO behavior change to the rules.
- [ ] **Step 3 (proof):** filter test green; arch:check still passes (no file over 600 lines).
- [ ] **Step 4: commit** `docs(ad-optimizer): record why competition_increase + account_level_issue stay advisory-only`

### Task 4: VERIFY (delegated gate-run + fresh-context independent review) + CONVERGE

- [ ] Dispatch a verifier subagent: typecheck; `pnpm test`; `pnpm --filter @switchboard/ad-optimizer test`;
      lint; format:check; arch:check; `CI=1 npx tsx scripts/local-verify-fast.ts`; `pnpm eval:riley`. (No app pkgs
      changed -> skip pnpm build; no schema -> skip db:check-drift.) Compact per-gate booleans + only failing excerpt.
- [ ] Dispatch a fresh-context independent reviewer (three-dot diff + acceptance criteria + lessons only; NOT self-graded).
- [ ] Triage with receiving-code-review; loop fixes to EXECUTE if any finding >= warn.
- [ ] Pre-merge divergence re-check (re-fetch origin/main; three-dot still clean-applies; gh pr list + git worktree
      list; rebase --onto if main moved). Disable any --auto before a late push.
- [ ] If ALL gates green + independent review zero >=warn + no merge-stop glob touched -> squash-merge. Else SURFACE.

## PROGRESS (2026-06-18)

baseline_sha: ebd58b252. Commits on feat/riley-audience-offer-mismatch-watch:

- e439490bf refactor: extract insufficientEvidenceWatch -> recommendation-watches.ts (engine 599->576; behavior-preserving, 775 green)
- 27a7a3df8 feat: audienceOfferMismatchIfSilent gate + audienceOfferMismatchWatch; engine 584 lines, complexity 22 (baseline 21)
- eb61e2e18 test: fixture audience-offer-mismatch.jsonl + drift-guard line + README row; eval 25+10+6 GREEN, drift-guard GREEN
- 36675ab93 docs: marker comments on competition_increase + account_level_issue (no behavior change); diagnostician 204 lines
  KEY GOTCHA (for resume): eval:riley + the drift-guard (vitest --config evals/vitest.config.ts) consume the BUILT
  @switchboard/ad-optimizer (dist/), NOT src. MUST `pnpm --filter @switchboard/ad-optimizer build` before running them.
  Unit tests (pnpm --filter ad-optimizer test) use src directly and don't need the rebuild.
  All ad-optimizer unit tests: 785 green (84 files). Line counts: engine 584, watches 78, diagnostician 204, new test 157 (all <600).
  gate_results (VERIFY, post-rebase onto origin/main @ 86b2708d0): typecheck=PASS(21/21) test(ad-optimizer)=PASS(786)
  full-pnpm-test=PASS except known apps/chat attribution load-FLAKE (passes isolated 4/4 in 1s; 0 chat files touched;
  feedback_reset_vs_build_and_chat_flake) lint=PASS(0 err) format=PASS arch=PASS verify-fast=PASS eval:riley=PASS(25+10+6)
  drift-guard=PASS(4/4) independent_review=SHIP (0 blocker/warn; 2 pre-existing cosmetic nits: complexity-22 pre-existing,
  relocated insufficientEvidenceWatch em-dash pre-existing/out-of-scope, LEFT verbatim). Rebased clean onto 86b2708d0
  (upstream advanced inside ad-optimizer: ctwa-adapter/meta-ads-client, different files, no conflict). All 4 auto-merge
  conditions MET -> merging via PR+CI. PR #1164 OPEN (https://github.com/jsonljc/switchboard/pull/1164),
  CI running. Next: when CI required checks pass (typecheck/lint/test/security + Eval-Riley), squash-merge
  (disable any --auto first; gh pr merge --squash). If security gate reds on a fresh transitive advisory
  unrelated to diff -> separate chore PR per feedback_ci_security_audit_gate, do NOT suppress here. If apps/chat
  attribution job flakes in CI (load) -> rerun that job (known flake). Then teardown worktree + memory note.
  carry_forward (<=150 words): Implementation COMPLETE (4 commits). Next: VERIFY — dispatch verifier subagent (rebuild
  ad-optimizer FIRST, then full gate suite incl eval:riley + eval vitest) + fresh-context independent reviewer
  (three-dot diff origin/main...HEAD + criteria + lessons; NOT self-graded). Triage. Then pre-merge divergence
  re-check + CONVERGE (AUTONOMOUS-WITH-GUARDRAILS: squash-merge iff all gates green + review zero >=warn + no stop-glob
  touched [none are] + divergence clean). Then optional tiny chore PR (bookedValueResolution help-text + MIRA flag doc).
  Update project_riley_capability_audit_2026_06_10 memory note when merged.

## Acceptance criteria

1. generateRecommendations emits exactly one `audience_offer_mismatch` watch in the pure-silence + diagnosis case;
   none in every suppression case (add_creative/pause, landing_page_drop-hold, breach_building, burn) or diagnosis-absent.
2. The watch reaches AuditReport via the generic passthrough (proven by the eval fixture through the real decide seam).
3. competition_increase + account_level_issue still produce NO watch (guard tests + marker comments documenting why).
4. All required gates green incl. eval:riley (24+10+6 + the new case) + drift-guard; no schema migration; no money path.
