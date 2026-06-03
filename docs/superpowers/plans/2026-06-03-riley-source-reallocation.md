# Riley source-reallocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, this session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Riley emit one evidence-gated, eval-covered, advisory `shift_budget_to_source` recommendation from the account-level per-source economics it already computes (otherwise discarded), abstaining to a watch when thin/tied/untrusted, with the economic basis surfaced via the #841 dataLines channel.

**Architecture:** A new pure account-level decision (`decideSourceReallocation`) + a thin sync orchestrator (`computeSourceReallocationSection`) live in one focused module; `audit-runner` calls the orchestrator once (relocating the Step-8b `sourceComparison` compute out of the 590-line file). The never-reached per-campaign `shift_budget_to_source` branch is removed (no corpse). Presentation rides existing `params` + a sink cells helper. The eval gains a parallel source-reallocation seam.

**Tech Stack:** TypeScript (ESM, `.js` imports), Zod, Vitest, tsx (eval runner). Backend only — `@switchboard/ad-optimizer` + `evals/`. No schema change, no dashboard, no mutating path.

Spec: `docs/superpowers/specs/2026-06-03-riley-source-reallocation-design.md`.

---

## File structure

| File                                                                        | Responsibility                                                                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ad-optimizer/src/analyzers/source-reallocation.ts` (new)          | `decideSourceReallocation` (pure decision), `findShiftCandidates` (relocated), `computeSourceReallocationSection` (orchestrator), floors |
| `packages/ad-optimizer/src/analyzers/source-reallocation.test.ts` (new)     | co-located unit tests (every gate branch)                                                                                                |
| `packages/ad-optimizer/src/index.ts`                                        | export the new function + types                                                                                                          |
| `packages/ad-optimizer/src/audit-runner.ts`                                 | call the orchestrator once; push rec/watch; drop the inline Step-8b source block                                                         |
| `packages/ad-optimizer/src/recommendation-engine.ts`                        | remove dead shift branch + `findShiftCandidates` + `SHIFT_*` + `sourceComparison` input                                                  |
| `packages/ad-optimizer/src/campaign-decision.ts`                            | remove `sourceComparison` field + forwarding                                                                                             |
| `packages/ad-optimizer/src/recommendation-engine.test.ts`                   | drop the now-dead shift tests (behavior relocated + covered in the new module + eval)                                                    |
| `packages/ad-optimizer/src/recommendation-sink.ts`                          | `sourceReallocationCells` + append in `buildPresentation`                                                                                |
| `packages/ad-optimizer/src/__tests__/recommendation-sink.test.ts`           | dataLine test                                                                                                                            |
| `evals/riley-recommendation/source-reallocation-eval.ts` (new)              | case schema + real-seam decide + subdir loader                                                                                           |
| `evals/riley-recommendation/fixtures/source-reallocation/cases.jsonl` (new) | discriminating fixtures                                                                                                                  |
| `evals/riley-recommendation/__tests__/source-reallocation.test.ts` (new)    | vitest gate (globbed by `evals/vitest.config.ts:14`)                                                                                     |
| `evals/riley-recommendation/run-eval.ts`                                    | also load + assert source-reallocation cases                                                                                             |

New-files justification (CLAUDE.md >3 rule): the pure decision module + its mandated co-located test; the eval coverage (one lib file + fixtures + test) required by the DoD. The orchestrator shares the decision module (not a separate file).

---

## Task 1: New module `source-reallocation.ts` (pure decision + orchestrator)

**Files:**

- Create: `packages/ad-optimizer/src/analyzers/source-reallocation.ts`
- Test: `packages/ad-optimizer/src/analyzers/source-reallocation.test.ts`

- [ ] **Step 1: Write the failing test** (`source-reallocation.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { decideSourceReallocation, MIN_SOURCE_BOOKINGS } from "./source-reallocation.js";
import type { SourceComparisonRow } from "./source-comparator.js";
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";

const funnel = (over: Partial<SourceFunnel>): SourceFunnel => ({
  received: 40,
  qualified: 20,
  booked: 10,
  showed: 0,
  paid: 8,
  revenue: 0,
  ...over,
});
const row = (
  source: string,
  trueRoas: number | null,
  closeRate: number | null,
): SourceComparisonRow => ({
  source,
  cpl: 10,
  costPerQualified: 20,
  costPerBooked: 30,
  closeRate,
  trueRoas,
});
const goodEvidence = { clicks: 200, conversions: 20, days: 7 };
const base = {
  bySource: { ctwa: funnel({}), instant_form: funnel({}) } as Record<string, SourceFunnel>,
  accountEvidence: goodEvidence,
  measurementTrusted: true,
  nextCycleDate: "2026-05-14",
};

describe("decideSourceReallocation", () => {
  it("recommends shift toward the materially-better source (≥2x trueRoas, evidence both sides)", () => {
    const r = decideSourceReallocation({
      ...base,
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r?.type).toBe("recommendation");
    expect(r && "action" in r && r.action).toBe("shift_budget_to_source");
    expect(r && "campaignId" in r && r.campaignId).toBe("account");
    expect(r && "params" in r && r.params).toMatchObject({ from: "instant_form", to: "ctwa" });
  });

  it("returns null when economics are tied (ratio < 2x) — no signal, no abstention noise", () => {
    const r = decideSourceReallocation({
      ...base,
      sourceComparison: { rows: [row("ctwa", 2.0, 0.2), row("instant_form", 1.8, 0.07)] },
    });
    expect(r).toBeNull();
  });

  it("abstains to insufficient_evidence when a side is under the per-source floor", () => {
    const r = decideSourceReallocation({
      ...base,
      bySource: { ctwa: funnel({}), instant_form: funnel({ booked: MIN_SOURCE_BOOKINGS - 1 }) },
      sourceComparison: { rows: [row("ctwa", 4.0, 0.25), row("instant_form", 1.0, 0.05)] },
    });
    expect(r?.type).toBe("watch");
    expect(r && "pattern" in r && r.pattern).toBe("insufficient_evidence");
  });

  it("abstains to measurement_untrusted when the cost signal is suspect", () => {
    const r = decideSourceReallocation({
      ...base,
      measurementTrusted: false,
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r?.type).toBe("watch");
    expect(r && "pattern" in r && r.pattern).toBe("measurement_untrusted");
  });

  it("abstains to insufficient_evidence when account-wide volume is under the scale floor", () => {
    const r = decideSourceReallocation({
      ...base,
      accountEvidence: { clicks: 20, conversions: 20, days: 7 }, // clicks < 30 (scale floor)
      sourceComparison: { rows: [row("ctwa", 3.8, 0.2), row("instant_form", 1.5, 0.07)] },
    });
    expect(r?.type).toBe("watch");
    expect(r && "pattern" in r && r.pattern).toBe("insufficient_evidence");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing)

Run: `pnpm --filter @switchboard/ad-optimizer test source-reallocation`
Expected: FAIL (cannot find `./source-reallocation.js`).

- [ ] **Step 3: Implement `source-reallocation.ts`** — the pure decision + relocated `findShiftCandidates` + orchestrator. (Full code in the spec §Design.1; key points: `findShiftCandidates` copied verbatim from `recommendation-engine.ts:93-113`; `SHIFT_TRUE_ROAS_RATIO=2`, `SHIFT_MIN_CLOSE_RATE=0.05`; `MIN_SOURCE_LEADS=10`, `MIN_SOURCE_BOOKINGS=3` exported; gate order: candidate→null, then measurement_untrusted, then per-source floor, then `meetsEvidenceFloor("shift_budget_to_source", accountEvidence)`, else the rec; rec carries `campaignId:"account"`, `campaignName:"${from}→${to}"`, `params:{from,to,fromTrueRoas,toTrueRoas}`, `learningPhaseImpact`/`resetsLearning` from `action-reset-classification.js`.) `computeSourceReallocationSection` extracts `crmData.bySource`, runs `computeSpendBySource`+`compareSources`, sums `accountEvidence` from `currentInsights`, calls `decideSourceReallocation`, returns `{ sourceComparison?, reallocation }`.

- [ ] **Step 4: Run, expect PASS.** `pnpm --filter @switchboard/ad-optimizer test source-reallocation`
- [ ] **Step 5: Add an orchestrator test** — `computeSourceReallocationSection` returns `{ reallocation: null }` for empty `bySource`, and a recommendation for a clear winner with sufficient spend/funnels.
- [ ] **Step 6: Commit.** `git add … && git commit -m "feat(ad-optimizer): account-level source-reallocation decision + section orchestrator"`

## Task 2: Export from package entry

**Files:** Modify `packages/ad-optimizer/src/index.ts`

- [ ] **Step 1:** Add `export { decideSourceReallocation, computeSourceReallocationSection, findShiftCandidates } from "./analyzers/source-reallocation.js";` and `export type { SourceReallocationInput } from "./analyzers/source-reallocation.js";`
- [ ] **Step 2:** `pnpm --filter @switchboard/ad-optimizer build` → PASS.
- [ ] **Step 3: Commit.** `git commit -m "feat(ad-optimizer): export source-reallocation from package entry"`

## Task 3: Wire into `audit-runner.ts` (relocate Step-8b source block)

**Files:** Modify `packages/ad-optimizer/src/audit-runner.ts`

- [ ] **Step 1:** Add import `import { computeSourceReallocationSection } from "./analyzers/source-reallocation.js";`. Replace the Step-8b `sourceComparison` block (current lines ~496-503) with a call to `computeSourceReallocationSection({ crmData, currentInsights, adSetData, measurementTrusted, nextCycleDate })`, destructure `{ sourceComparison, reallocation }`, and `recommendations.push`/`watches.push` the reallocation by `type`. Drop now-unused imports (`compareSources` from line 27; `computeSpendBySource` line 29; `SourceFunnel` line 30 if unused) — grep-verify before removing.
- [ ] **Step 2:** `pnpm --filter @switchboard/ad-optimizer build` PASS; `pnpm arch:check` PASS (audit-runner < 600 — expect ~587).
- [ ] **Step 3:** Run audit-runner tests: `pnpm --filter @switchboard/ad-optimizer test audit-runner` → PASS (report `sourceComparison`/`campaignEconomics` unchanged). Add a focused assertion that a clear-winner audit emits a `shift_budget_to_source` rec.
- [ ] **Step 4: Commit.** `git commit -m "feat(ad-optimizer): wire account-level source reallocation into the audit"`

## Task 4: Remove the dead per-campaign shift branch

**Files:** Modify `recommendation-engine.ts`, `campaign-decision.ts`, `recommendation-engine.test.ts`

- [ ] **Step 1:** In `recommendation-engine.ts` delete: the shift branch (314-334), `findShiftCandidates` (93-113), `SHIFT_*` (90-91), the `sourceComparison` field on `RecommendationInput` (46). Remove the `SourceComparisonRow` import/re-export (3/18) ONLY if grep shows no remaining importer relies on the re-export.
- [ ] **Step 2:** In `campaign-decision.ts` delete the `sourceComparison` field (59) + forwarding (161).
- [ ] **Step 3:** In `recommendation-engine.test.ts` delete the shift-branch tests (search `shift_budget_to_source`/`sourceComparison`).
- [ ] **Step 4:** `pnpm --filter @switchboard/ad-optimizer build && pnpm --filter @switchboard/ad-optimizer test` → PASS. `pnpm eval:riley` → PASS (matrix never covered the action, so no fixture breaks).
- [ ] **Step 5: Commit.** `git commit -m "refactor(ad-optimizer): drop the never-reached per-campaign shift branch (relocated to account-level)"`

## Task 5: Surface the economic basis (#841 dataLines)

**Files:** Modify `recommendation-sink.ts`, `__tests__/recommendation-sink.test.ts`

- [ ] **Step 1: Failing test** — a `shift_budget_to_source` rec with `params:{from,to,fromTrueRoas:"1.5",toTrueRoas:"3.8"}` yields a `dataLines` entry containing `["ctwa 3.8x true ROAS","instant_form 1.5x true ROAS"]`; a shift rec with no trueRoas params yields no such line (honest-null).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `sourceReallocationCells(params)` (honest-null; `Number(...).toFixed(1)`, never re-divide) and append it in `buildPresentation` for `rec.action === "shift_budget_to_source"` (between the economics line and the learning-phase line).
- [ ] **Step 4: Run, expect PASS.** `pnpm --filter @switchboard/ad-optimizer test recommendation-sink`
- [ ] **Step 5: Commit.** `git commit -m "feat(ad-optimizer): surface source-reallocation economic basis on the approval card"`

## Task 6: Extend the eval (`evals/riley-recommendation`)

**Files:** Create `source-reallocation-eval.ts`, `fixtures/source-reallocation/cases.jsonl`, `__tests__/source-reallocation.test.ts`; modify `run-eval.ts`

- [ ] **Step 1:** Create `source-reallocation-eval.ts`: `SourceReallocationCaseSchema` (sources[]: source/received/qualified/booked/paid/revenueCents/spend; accountEvidence; measurementTrusted?; expectedOutcome ∈ {shift_budget_to_source,watch,none}; expectedWatchPattern?); `decideSourceReallocationForCase(c)` building `bySource`+`spendBySource` from the fixture, calling the REAL `compareSources` then `decideSourceReallocation`, reducing to `{ outcome, watchPattern }`; `loadSourceReallocationCases(dir)` reading `*.jsonl` under the subdir (mirror `load-fixtures.ts`).
- [ ] **Step 2:** Create `fixtures/source-reallocation/cases.jsonl` — 5 discriminating cases: reallocate-clear-winner (→ shift_budget_to_source), abstain-tied (→ none), abstain-thin-source (loser booked<3 → watch/insufficient_evidence), abstain-untrusted (measurementTrusted:false → watch/measurement_untrusted), abstain-account-thin (clicks<30 → watch/insufficient_evidence). trueRoas set via `revenueCents/100/spend` (normalizeConversionValue = cents→dollars).
- [ ] **Step 3:** Create `__tests__/source-reallocation.test.ts` — load cases, assert `decideSourceReallocationForCase` outcome + watchPattern each.
- [ ] **Step 4:** Extend `run-eval.ts` `main()` to also load + assert source-reallocation cases (so `pnpm eval:riley` covers them).
- [ ] **Step 5: Run** `pnpm exec vitest run --config evals/vitest.config.ts riley-recommendation` and `pnpm eval:riley` → PASS.
- [ ] **Step 6: Commit.** `git commit -m "test(evals): cover Riley source-reallocation decide + abstention paths"`

## Task 7: Full gate, review, PR

- [ ] **Step 1:** `pnpm reset` if any stale-Prisma cross-package false alarm (client already regenerated). Then the full gate: `pnpm typecheck`, `pnpm test`, `pnpm --filter @switchboard/dashboard build`, `pnpm arch:check`, `pnpm lint`, `pnpm format:check`, `pnpm eval:riley`.
- [ ] **Step 2:** Advisory-only proof: `git diff origin/main...HEAD` shows zero new `PlatformIngress`/`submit(`/Meta-write/mutating callers; the only new emission is a `RecommendationOutput` through the existing sink.
- [ ] **Step 3:** `/codex:adversarial-review` + a `requesting-code-review` subagent on the diff; address findings (verify before implementing).
- [ ] **Step 4:** Open a focused PR to `main`; enable auto-merge. Note the deliberate cross-campaign deferral + the dead-branch relocation in the PR body.

---

## Self-review

**Spec coverage:** wire orphan→Task 1/3; gate (evidence+measurement+honest-null)→Task 1; eval reallocate+abstain→Task 6; dataLines basis→Task 5; advisory-only→Task 7.2; cross-campaign deferral→PR note (Task 7.4); 600-cap→Task 3 (relocation). All covered.

**Placeholder scan:** gate order, constants (2 / 0.05 / 10 / 3), fixture outcomes, and commands are concrete. No TBD.

**Type consistency:** `decideSourceReallocation` returns `RecommendationOutput | WatchOutput | null` in Task 1, consumed by `computeSourceReallocationSection` (Task 1) and `audit-runner` (Task 3) by `.type`; `params` keys `from/to/fromTrueRoas/toTrueRoas` set in Task 1 and read in Task 5 `sourceReallocationCells`; eval `decideSourceReallocationForCase` (Task 6) calls the same exported `decideSourceReallocation`. Consistent.
