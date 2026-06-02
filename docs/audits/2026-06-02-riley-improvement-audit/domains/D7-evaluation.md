# D7 — Evaluation, Measurement & Regression Safety for Riley

> Raw domain audit. `file:line` against `main`. Synthesis: [`../FINDINGS.md`](../FINDINGS.md).

## 1. CURRENT STATE (verified)

**The `evals/` workspace has three harnesses; ZERO cover Riley.** `evals/claim-classifier/`, `evals/alex-conversation/`, `evals/governance-decision/`. CI gates: `.github/workflows/ci.yml:345` (`eval-classifier`, blocking), `:397` (`eval-alex-conversation`, informational), `:452` (`eval-governance-decision`, blocking). **No `eval-ad-optimizer`/`eval-riley` job.** No ad-optimizer eval script in `package.json:37-40`.

**#781's golden-scenario suite covers Alex + governance + classifier ONLY.** 64 alex scenarios, a 21-cell governance matrix, 15-20 classifier rows. Ad-optimizer never mentioned. **(b): #781 does not touch Riley.**

**Riley's recommendation quality is measured only by isolated unit tests with hand-built inputs** — `recommendation-engine.test.ts` (23 tests) pass synthetic `diagnoses`/`deltas`/`targetBreach` directly (e.g. `:301` feeds `periodsAboveTarget:10` literally). Never raw-campaign → recommendation.

**The audit-runner E2E test asserts STRUCTURE, not correctness.** `audit-runner.test.ts` (12 tests): `recommendations` is an array (`:259`), `totalSpend===8000` (`:290`), funnel shape, signal-health short-circuit (`:536-649`). **Not one assertion of "given this campaign, expect a `pause`/`scale`/`watch`."** The closest (`:296`) only asserts an *insight*. **(a): essentially NO end-to-end "given campaign → expect recommendation" test on main.**

**The cron test asserts pure orchestration** (`inngest-functions.test.ts`, 24 tests). Zero recommendation-content assertions.

**Post-Eyes (#792) added ONE real scenario test** — `audit-runner-integration.test.ts` (2 tests): "fires pause on durable daily breach" + "downgrades to watch when material child is LEARNING." **The only genuine raw-data→recommendation test in the codebase** and the template PR4 should generalize. `economicTier`/`marginAware`/`candidateAction` absent (grep empty).

**The §3 quality contract is mostly untested and partly unimplemented:**
- *Economically targeted* §3.1: NOT implemented (`recommendation-engine.ts:48,180` drives off CPL; `metrics-riley.ts:57,100-105` forces `qualifiedPct=0`).
- *Evidence-gated* §3.2: PARTIAL — the **click floor is MISSING** (`recommendation-engine.ts:187-197` gates only on `periodsAboveTarget>=7`; no ≥20-clicks floor; the integration test uses 200 clicks so wouldn't catch it).
- *Learning-phase protected* §3.3: tested (`learning-phase-guard.test.ts`, 22 tests).
- *Margin-aware* §3.4: NOT implemented/untested.
- *Operator-explainable* §3.5: partial (no economic-tier naming because tier doesn't exist).
- *Non-mutating + abstention* §3.6: **NO no-ghost-execution assertion** (the only `not.toHaveBeenCalled()`, `:648`, is the signal-health checker); no thin-data/non-durable → `watch` test.

**Reusable assets:** `evals/governance-decision/` is a clean, copyable template — model-free, DB-free, JSONL fixtures → real decision fn → diff with exit code (`run-eval.ts:1-50`), a blocking CI job today. `claim-classifier/score.ts` provides the regression-count/tolerance pattern (`countWrong`, `OVERALL_TOLERANCE_BPS`). `AuditRunner` is fully dependency-injected (`audit-runner.ts:71-116`); `generateRecommendations` is pure.

## 2. GAPS / WEAKNESSES
- **G1 — No living recommendation-quality benchmark or CI gate.** "Outperform human" is asserted (§2) but unmeasured. PR4 is the *plan* but is a one-time snapshot for human review (spec:100), not a versioned machine-checked gate.
- **G2 — Quality tested at the wrong layer.** All graded assertions are in `recommendation-engine.test.ts`, which bypasses insights→diagnostician→deltas→learning gate→tier→engine. A regression in those layers can't be caught. The one true E2E (2 cases) is too thin.
- **G3 — No regression guard.** Unlike classifier (`baseline.json`+`countWrong`) and governance (drift-guard), a change to any Riley threshold reds nothing beyond hand-built unit tests a developer edits in lockstep. **(f): no guard against silent quality regression.** Highest-leverage gap for "safe-to-iterate."
- **G4 — The no-mutation invariant is a comment, not a test.** As Phase 2 adds `updateCampaignBudget`, nothing mechanically prevents a Phase-1 path gaining a mutating caller.
- **G5 — Coverage thin on judgment vs plumbing.** Heavy on dispatch/IO (`meta-capi-dispatcher` 23, `inngest-functions` 24); light on judgment (`funnel-analyzer` 2, `source-comparator` 2 — the booked-CAC economics the Target thesis rests on, `:34-48`). **(d): thinnest on (i) audit-runner emission decisions, (ii) the fallback ladder §5 (unbuilt), (iii) abstention, (iv) budget imbalance → reallocation (detected `budget-analyzer.test.ts:68` then DROPPED at `audit-runner.ts:489-507`).**
- **G6 — Tier/fallback-ladder testability designed but absent** (§5, the spec's "highest-risk element").
- **G7 — PR4 snapshot has no versioning/promotion path** (unlike the classifier/alex bake→flip model). A snapshot reviewed once provides zero day-2 protection.

## 3. RANKED RECOMMENDATIONS (by leverage on making "outperform-human" measurable + safe-to-iterate)

**R1 — Build `evals/ad-optimizer-recommendation/`: a model-free, CI-gated Riley scenario benchmark.** Clone `evals/governance-decision/` (model-free, DB-free, already a blocking CI pattern). Fixtures = JSONL of realistic medspa campaign scenarios (full `AuditDependencies`) → expected recommendation set `{action, urgency-band, economicTier, marginBasis}` **including expected refusals**. The runner builds a real `AuditRunner`, runs `.run()`, diffs against the oracle. Seed from the 2 integration cases + the 23 engine cases lifted to full-pipeline inputs. **This IS the "outperform-human as a tracked metric" deliverable** — closes G1+G2 at the right layer; model-free ⇒ runs in CI today, no credit-gating, no Postgres. New `evals/ad-optimizer-recommendation/`; `package.json:40`; `ci.yml:452`. Effort M, risk low. **Single highest-leverage item.** *TAG: promotes PR4 snapshot → living gate.*

**R2 — Add the no-ghost-execution test as a standing invariant.** Run a full Phase-1 audit; assert zero calls to any `MetaAdsClient` mutating method / `apply_ad_action` dispatch / ad-action WorkTrace. Spy the injected `adsClient`. Effort S. Buildable on main today. *TAG: PR4 §4 (specced, absent).* (= D5 R3.)

**R3 — Add `baseline.json` + regression-count gate to R1.** Layer the classifier's mechanism (`score.ts:54-118`) with a committed baseline + documented promotion path. Deterministic ⇒ **blocking from day one** (no bake). Effort S. Deps R1. *TAG: makes PR4 a permanent gate.*

**R4 — Full-pipeline scenario tests for the thinnest decision-critical paths.** E2E `AuditRunner` tests for: (a) booked-CAC vs CPL divergence ("cheap junk leads is NOT a win"); (b) fallback ladder sufficient/sparse; (c) abstention trio (thin/learning/non-durable → `watch`); (d) imbalance → `shift_budget` (detected-then-dropped); (e) the missing ≥20-click floor. `audit-runner.test.ts`; gaps at `recommendation-engine.ts:187`, `audit-runner.ts:489-507,146`. Effort M. *TAG: PR2+PR3+PR4 acceptance.*

**R5 — Bump diagnostician + source-comparator coverage; pin thresholds via the benchmark, not lockstep unit tests.** `source-comparator.ts:34-48` has 2 tests despite carrying the Target thesis; assert §3.3/§5 thresholds *through* benchmark fixtures so they can't be silently retuned. Effort S-M. *TAG: PR3 hardening.*

## 4. VERIFICATION LOG
Read both specs; commit body `1b165d63` (#781 scope = alex/governance/classifier, no ad-optimizer); `docs/agent-eval-golden-scenarios.md`, `docs/classifier-eval.md`. Listed `evals/` (3 harnesses, none Riley); grepped `ci.yml` jobs + `package.json` (no Riley gate). Read `audit-runner.test.ts`/`audit-runner.ts` (structure-only; CPL driver `:146`; imbalance built `:489-507` never emitted). Read `recommendation-engine.test.ts`/`recommendation-engine.ts:1-220` (hand-injected; no click floor; tier/margin absent). Read post-Eyes `audit-runner-integration.test.ts` (2 tests, 200 clicks). Grepped schemas for contract fields (only `costPerBooked`/`trueRoas`). Read `evals/governance-decision/run-eval.ts` + `claim-classifier/score.ts` (copy-ready). Confirmed the only `not.toHaveBeenCalled()` is signal-health, not a no-mutation guard.
**Bottom line:** Riley quality is measured only by isolated hand-injected engine tests + one 2-case E2E. #781 doesn't cover Riley. No living benchmark, no regression gate, no no-mutation invariant. But `AuditRunner` is fully DI'd and `evals/governance-decision/` is a copy-ready model-free CI template — so a deterministic Riley benchmark (R1+R3) is low-cost and is the natural promotion of PR4's snapshot into a permanent gate.
