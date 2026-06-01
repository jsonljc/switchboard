# Agent Eval Golden-Scenario Regression Suite — Design

**Date:** 2026-06-01
**Branch:** `feat/agent-eval-golden-scenarios`
**Status:** Design (authored autonomously per operator directive; decisions recorded inline rather than gated on interactive approval)

## 1. Problem & leverage

Switchboard's agent eval coverage is thin. Two harnesses exist:

- **`evals/claim-classifier/`** — LIVE, gating. 105 fixtures, Haiku baseline locked at 97.1% (`baseline.json`, prompt-hash + per-claim-type accuracy with `toleranceBps: 200`). Real Anthropic Haiku classifier.
- **`evals/alex-conversation/`** — INFORMATIONAL (`continue-on-error: true`), no `baseline.json` yet, 14-day bake pending. Only **8 fixtures**. Real pipeline: `run-conversation.ts` drives Alex (Sonnet 4.6) against `mock-tools.ts`, then grades each Alex turn deterministically (`grade.ts`: tool-allowlist hard gate + advisory claim warnings) and via an LLM judge (`judge.ts`: tier-2 semantic hard rules + tier-3 soft score 0–5).

This is rank-2 of a 2026-05-31 leverage triage (score 80): "compounding velocity/safety; flips alex-conversation from informational scaffold to a hard gate." The deliverable is a **generated, oracle-backed golden-scenario regression suite** plus the gating mechanism, so future agent changes become measurable.

### What "oracle-backed" means here

The current alex harness has no per-fixture machine-checkable oracle for *trajectory* (tool sequence, escalation). Its oracles today are:
1. A **global** tool allowlist (`ALEX_ALLOWED_TOOL_IDS = ["crm-query","crm-write","calendar-book","escalate"]`) — any out-of-set tool fails deterministically.
2. The **judge** (global rubric `judge-medspa@1.0.0`) consuming per-turn `grade` hints (`mustAsk/mustDo/mustNot/shouldDo`).
3. Advisory per-sentence claim warnings (never gate).

A "golden conversation" needs more: *for this discovery-only scenario, Alex must NOT call `calendar-book`*; *for this red-flag scenario, Alex MUST call `escalate`*. That is the gap this design closes.

## 2. Scope (bounded — avoid sprawl)

In scope:
1. **Alex-conversation expansion** to ~60–90 high-quality golden + edge scenarios across a stage × locale × concern matrix, each carrying a machine-checkable **oracle** + judge `grade` expectations.
2. **Additive oracle layer**: optional per-fixture `oracle` block + a pure `evaluateOracle()` deterministic checker, wired as an extra deterministic gate (non-breaking).
3. **Governance-decision mini-matrix** (`evals/governance-decision/`): a deterministic, model-free, DB-free harness over the **real live governance gate** (`getToolGovernanceDecision` + `GOVERNANCE_POLICY`) and `trustLevelFromScore` boundaries.
4. **Classifier boundary variants** (~15–20): ambiguous-boundary, negated, adversarial-false-positive, code-switch — staged for structural validation now, live-scored later.
5. **Baseline capture mechanism + documented promotion path** (informational → blocking after bake). **Do NOT** flip alex-conversation to a blocking gate in this PR.

Explicitly **out of scope** (documented, with rationale):
- **PII-minimization governance oracle** — #775 ("trusted runtime injection") ships PII handling, but there is no pure, importable decision function (`pii`/`redact`/`minimize`/`sanitize` absent from `packages/`) to oracle against without a live runtime. Deferred.
- **Cross-tenant governance oracle** — org isolation is a storage/query-layer invariant (`organizationId` in store queries), not a pure decision function; testing it needs a DB/Prisma mock, and "db tests mock Prisma; CI has no Postgres." Deferred.
- **Flipping any gate to blocking** — gated on the #672 eval-credit situation and the 14-day bake (classifier bake ≥2026-06-06, #631). This PR builds the mechanism, not the flip.
- **Changing the production classifier or Alex skill content** — eval-only PR.

## 3. Taxonomy (the canonical decision)

### 3.1 Alex-conversation scenario matrix

Each scenario is tagged with a **stage** and free-form **tags**. The generated suite must fill this matrix:

**Stages** (new optional `stage` enum):
`discovery` · `objection` · `qualification` · `booking` · `post-booking` · `safety` · `refusal` · `reactivation` · `full-arc`

- `full-arc` = a multi-turn golden conversation walking discovery → objection → qualification → booking in one fixture.

**Locales:** `sg`, `my` (existing). Both must be represented in every stage where it matters; mixed-language (Singlish / Manglish / zh) variants included.

**Concern / objection axes** (encoded in `tags` + `scenario`):
- price-sensitivity, results-skepticism, safety-anxiety, time/convenience, trust/credentials, comparison-shopping, decision-deferral/hesitation, aggressive-discount-bait, unsafe-claim-bait, medical-red-flag (→ escalate), out-of-scope/refusal, post-booking logistics, reactivation of a cold lead.

**Edge dimensions:**
- multi-turn (≥3 lead turns), code-switch language, tool-error recovery (lead pushes after a simulated failed action — Alex must not fabricate success), escalation-required (medical red flag / explicit human request), do-not-book guardrails.

**Coverage targets** (asserted by a `matrix.test.ts`):
- ≥ 60 and ≤ 95 total scenarios (sanity bounds — fail if generation under/over-produces).
- Every `stage` value has ≥ 3 scenarios.
- Both locales present overall; ≥ 8 scenarios per locale.
- ≥ 6 `full-arc` scenarios.
- ≥ 6 scenarios with `expectsEscalation: true`; ≥ 6 with `forbiddenTools` including `calendar-book` (do-not-book guardrails).
- All scenario `id`s unique; all `oracle` blocks well-formed; all fixtures pass `ConversationFixtureSchema`.

### 3.2 Oracle format (the canonical decision)

New **optional** `oracle` block on each fixture, all fields optional, all machine-checkable against captured tool calls:

```jsonc
"oracle": {
  "expectedTools":   ["crm-query"],        // each MUST be called ≥1× across the conversation
  "forbiddenTools":  ["calendar-book"],    // none may be called
  "expectsEscalation": true,               // true ⇒ `escalate` MUST appear; false ⇒ MUST NOT; omit ⇒ no constraint
  "expectsBooking":    false               // true ⇒ `calendar-book` MUST appear; false ⇒ MUST NOT; omit ⇒ no constraint
}
```

Well-formedness rules (Zod refinements + a dedicated test):
- `expectedTools`, `forbiddenTools` ⊆ `ALEX_ALLOWED_TOOL_IDS`.
- `expectedTools` ∩ `forbiddenTools` = ∅.
- `expectsEscalation === true` ⇒ `escalate` not in `forbiddenTools`; `expectsEscalation === false` is consistent with `escalate` absent.
- `expectsBooking === true` ⇒ `calendar-book` not in `forbiddenTools`; `expectsBooking === false` is treated by the checker as "`calendar-book` must not appear" (so it must not also be listed in `expectedTools`).

`evaluateOracle(toolCalls: {toolId: string}[], oracle): { pass: boolean, violations: OracleViolation[] }` is a **pure function** (no I/O). Violations use stable codes: `missing-expected-tool:<id>`, `forbidden-tool-called:<id>`, `expected-escalation-missing`, `unexpected-escalation`, `expected-booking-missing`, `unexpected-booking`.

This is **dual-mode**:
- **Structural** (no model): the `oracle` block is schema- and well-formedness-validated by `oracle.test.ts` / `matrix.test.ts`. This is the deliverable that runs in CI today (no credits).
- **Live** (credit-gated): `evaluateOracle` is wired into `run-eval.ts` as an additional deterministic gate; its violations fold into the scenario's deterministic `violations` and set `deterministicPass=false` when present. Non-breaking: scenarios without an `oracle` block behave exactly as today.

### 3.3 Governance-decision mini-matrix

A new deterministic harness `evals/governance-decision/` that imports the **real live gate** from `@switchboard/core` and asserts decisions over a case matrix. Two functions under test:

1. `getToolGovernanceDecision(effectCategory, trustLevel, operationGovernanceOverride?)` →
   `"auto-approve" | "require-approval" | "deny"`, backed by `GOVERNANCE_POLICY[EffectCategory][TrustLevel]`.
   - **EffectCategory** (7): `read, propose, simulate, write, external_send, external_mutation, irreversible`.
   - **TrustLevel** (3): `supervised, guided, autonomous`.
   - Full 7×3 grid (21 cases) pinned to the policy table, plus override cases (override forces a decision regardless of the base policy cell).
2. `trustLevelFromScore(score)` → tier. Boundary cases: 0, 29, 30, 31, 54, 55, 56, 100 (pins the ≥55 / ≥30 thresholds).

Cases are JSONL fixtures `{ id, kind, ...inputs, expectedDecision|expectedTier, notes? }`. The runner is **model-free and DB-free**, so it both validates structurally *and* executes in CI (as a vitest test under `evals/vitest.config.ts`) — no API key, no Postgres. It also runs locally now as part of this PR's verification (genuine green, not just structural).

If `getToolGovernanceDecision` / `trustLevelFromScore` are not already exported from the `@switchboard/core` barrel, export them (minimal, justified: they are the declared governance source of truth and now have eval coverage + the missing co-located unit tests).

### 3.4 Classifier boundary variants

~15–20 new rows in `evals/claim-classifier/fixtures-candidate/boundary.jsonl` (a **staging directory NOT auto-loaded** by `loadFixtures`, which globs `fixtures/*.jsonl`). Categories:
- **ambiguous-boundary** — genuinely between two labels; use `acceptableClaimTypes` (e.g. efficacy-via-testimonial).
- **negated** — "we never promise results" → `none`.
- **adversarial-false-positive** — claim-shaped but non-claim ("results vary; ask the doctor") → `none`. These specifically probe over-flagging.
- **code-switch** — `zh` / `ms` phrasings of real claims.

Why staged, not added to `fixtures/`: the classifier gate is **required** (not `continue-on-error`) and accuracy-based. Adversarial-false-positive rows are *designed* to be hard; if the live classifier over-flags them, dropping them straight into `fixtures/` would turn the required gate red before a baseline recapture (which needs API credits we may not have). Staging keeps the required gate green, delivers structurally-validated, review-ready rows, and documents an explicit promotion path that parallels the alex bake. A new `fixtures-candidate.test.ts` validates them (schema, unique ids, valid claim-type/jurisdiction/language, `acceptableClaimTypes ⊆ enum`).

## 4. Components & file plan

```
evals/alex-conversation/
  schema.ts                 (EXTEND: optional stage, tags, oracle)
  oracle.ts                 (NEW: ConversationOracleSchema + evaluateOracle, pure)
  run-eval.ts               (EDIT: wire evaluateOracle as extra deterministic gate)
  fixtures/*.jsonl          (NEW: ~60–90 golden + edge scenarios)
  __tests__/oracle.test.ts  (NEW: TDD evaluator + well-formedness)
  __tests__/matrix.test.ts  (NEW: matrix coverage + global well-formedness over fixtures/)
  README.md                 (EDIT: taxonomy, oracle format, promotion path)

evals/governance-decision/  (NEW harness, mirrors existing eval layout)
  schema.ts                 (GovernanceCaseSchema — discriminated by kind)
  run-eval.ts               (deterministic runner; imports @switchboard/core)
  fixtures/*.jsonl          (policy grid + overrides + trust-score boundaries)
  README.md
  __tests__/governance-decision.test.ts  (NEW: runs the matrix; model-free)
  __tests__/schema.test.ts               (NEW: fixture shape)

evals/claim-classifier/
  fixtures-candidate/boundary.jsonl       (NEW: ~15–20 staged variants)
  __tests__/fixtures-candidate.test.ts    (NEW: structural validation)
  README.md                               (EDIT: candidate dir + promotion path)

packages/core/src/skill-runtime/governance.test.ts  (NEW: co-located unit tests if missing)
packages/core/src/index.ts               (EDIT if needed: export the governance gate)

docs/agent-eval-golden-scenarios.md       (NEW: suite overview, structural-vs-live, promotion)
docs/superpowers/specs/2026-06-01-agent-eval-golden-scenarios-design.md  (this doc)
docs/superpowers/plans/2026-06-01-agent-eval-golden-scenarios-plan.md    (writing-plans output)
```

> `>3 new files` is justified by the task: it is explicitly an eval-suite expansion. Each new module is focused and co-located with tests per CLAUDE.md.

## 5. Data flow

**Structural path (CI today, no credits):**
`vitest run --config evals/vitest.config.ts` → loads every fixture → `ConversationFixtureSchema.parse` + `evaluateOracle` well-formedness + matrix coverage assertions + governance-decision matrix execution + classifier-candidate validation. All green ⇒ suite is structurally sound.

**Live path (credit-gated, separate):**
`pnpm eval:alex-conversation` → `run-conversation` (Sonnet) → per-turn `gradeDeterministic` (+ NEW `evaluateOracle`) + `judgeTurn` (Sonnet) → `aggregateScenarioResult` → `--write-baseline` captures `baseline.json` → subsequent runs `compareAgainstBaseline`. Stays `continue-on-error: true` until bake completes.

**Governance path (deterministic, runs everywhere):**
`getToolGovernanceDecision` / `trustLevelFromScore` invoked directly by the matrix test — no model, no DB.

## 6. Error handling & determinism

- `evaluateOracle` is total: undefined/empty oracle ⇒ `{pass:true, violations:[]}`. No throws on well-formed input; malformed oracles are caught at schema-parse time, never at evaluation time.
- Governance runner fails the test (non-zero) on any `expected !== actual`, printing a diff table.
- Classifier candidate validation fails on schema/uniqueness errors only (no model call).
- All generation is deterministic at validation time (fixtures are committed JSON; no `Date.now`/random in test code).

## 7. Testing strategy (TDD)

Failing-test-first for the three pure/structural units:
1. `oracle.test.ts` — evaluator truth table + well-formedness refinements (write tests → implement `oracle.ts`).
2. `governance-decision.test.ts` + `schema.test.ts` — assert the policy grid against `getToolGovernanceDecision` (write cases → wire runner). Because the gate is real, a wrong expectation fails loudly — the test *is* the oracle check.
3. `fixtures-candidate.test.ts` — structural validation of staged classifier rows.
Then `matrix.test.ts` once fixtures are generated. Scenario generation itself is fanned out via a dynamic Workflow (batch authors per matrix cell → structural validators), then deduped and integrated.

## 8. Promotion path (documented, not executed here)

- **alex-conversation:** capture `baseline.json` via `--write-baseline` once credits + a clean live run exist; keep `continue-on-error: true` for ≥14 days of zero false-positives; then flip to blocking (`.github/workflows/ci.yml`). The oracle gate ships *now* but only bites in live runs.
- **classifier candidates:** when credits exist, run live, recapture `baseline.json` (`--write-baseline`), move `boundary.jsonl` into `fixtures/`, commit baseline + fixtures together.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| New classifier rows redden the required gate | Staged dir not auto-loaded; promotion is explicit + credit-gated. |
| Oracle gate breaks existing 8 fixtures | `oracle` optional; absent ⇒ identical behavior. Existing fixtures untouched. |
| Governance export not in barrel | Add minimal export + co-located unit test (CLAUDE.md requires the test anyway). |
| 60–90 fixtures inflate live cost | Live run is informational + credit-gated + maintainer-triggered; structural path is free. |
| Generated fixtures low quality / duplicative | Workflow validation stage + `matrix.test.ts` + dedupe + a self-review critic pass. |

## 10. Decisions log (autonomous)

1. **Extend schema additively** (stage/tags/oracle) rather than fork a new fixture format — keeps one harness, one loader, backward-compatible.
2. **Oracle = tool-presence/absence + escalation/booking flags**, not a strict positional sequence — the runtime captures unordered tool calls per turn and a brittle positional sequence over a non-deterministic model would be flaky. Presence/absence + escalation is the high-signal, low-flake oracle.
3. **Governance matrix targets `getToolGovernanceDecision`** (the live gate) over `decideTrust` in `trust.ts` (which has no callers and no tests). `decideTrust` may also get unit tests opportunistically, but the eval pins the *live* path.
4. **Classifier variants staged**, not hot-added — protects the required gate, honest about credit-gating.
5. **PII + cross-tenant deferred** — no pure oracle target without a live runtime / DB.
6. **No gate flips** — mechanism only; bake + credits gate the flip.
