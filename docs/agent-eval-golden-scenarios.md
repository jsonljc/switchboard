# Agent Eval Golden-Scenario Suite

This is the operator's guide to Switchboard's expanded agent eval coverage. It
covers three harnesses under `evals/`, what each one gates, and what is validated
**structurally** (in CI today, no credits) versus **live** (credit-gated).

Design rationale: `docs/superpowers/specs/2026-06-01-agent-eval-golden-scenarios-design.md`.

## The three harnesses

| Harness                      | Under test                         | Needs a model? | Needs Postgres? | CI gate today                                                      |
| ---------------------------- | ---------------------------------- | -------------- | --------------- | ------------------------------------------------------------------ |
| `evals/claim-classifier/`    | The Haiku medical-claim classifier | yes (live)     | no              | **blocking** (accuracy vs `baseline.json`)                         |
| `evals/alex-conversation/`   | Alex (Sonnet) SDR conversations    | yes (live)     | no              | **informational** (`continue-on-error`), structural tests blocking |
| `evals/governance-decision/` | The live tool-governance gate      | **no**         | **no**          | **blocking** (deterministic)                                       |

"Structural tests" = the vitest unit tests run by `pnpm exec vitest run --config evals/vitest.config.ts`. They load + schema-validate every fixture, check oracle well-formedness, run the governance matrix, and validate classifier candidates — all with **no API key**.

## 1. alex-conversation — golden + edge scenarios with oracles

The fixture suite spans a **stage × locale × concern matrix** (see
`__tests__/matrix.test.ts` for the enforced coverage floor): discovery,
objection (price / results / time / trust), qualification, booking, full-arc
golden conversations, post-booking, reactivation, refusal, and
safety/escalation — across both `sg` and `my` locales, with code-switch and
tool-error edge variants.

### The oracle block (new, optional, backward-compatible)

Each fixture may carry a machine-checkable trajectory `oracle` (`oracle.ts`):

```jsonc
"oracle": {
  "expectedTools":   ["calendar-book"], // each MUST be called >=1x
  "forbiddenTools":  ["calendar-book"], // none may be called
  "expectsEscalation": true,            // true => escalate MUST appear; false => MUST NOT; omit => no constraint
  "expectsBooking":    false            // true => calendar-book MUST appear; false => MUST NOT; omit => no constraint
}
```

- **Allowed tools:** `crm-query`, `crm-write`, `calendar-book`, `escalate` (the global `ALEX_ALLOWED_TOOL_IDS`).
- **Well-formedness** (Zod refinements, validated structurally): tools ⊆ allowed; `expectedTools ∩ forbiddenTools = ∅`; `expectsEscalation:true` ⇏ escalate forbidden; `expectsBooking:false` ⇏ calendar-book expected.
- **Live behavior:** `evaluateOracle()` is folded into the deterministic gate in `run-eval.ts`. A scenario with an oracle violation fails `deterministicPass` (codes like `oracle:missing-expected-tool:calendar-book`, `oracle:expected-escalation-missing`). Fixtures **without** an oracle behave exactly as before.

Oracles favor robust negative constraints (`expectsBooking:false`, `expectsEscalation:true`) over brittle positional tool sequences, because the underlying model is non-deterministic.

### Baseline + promotion path

`run-eval.ts --write-baseline` captures `baseline.json` (deterministic pass,
judge score, behaviors). The CI job stays `continue-on-error: true` until the
bake completes (≥14 days on main, baseline committed, zero false-positives), then
the flag flips to make it blocking. **This PR does not flip it** — live scoring is
credit-gated (#672) and the alex baseline still needs its bake (cf. classifier
bake ≥2026-06-06, #631).

## 2. governance-decision — deterministic policy matrix

`evals/governance-decision/` pins the **live** tool-governance gate
(`getToolGovernanceDecision` + `GOVERNANCE_POLICY`, in
`packages/core/src/skill-runtime/governance.ts`). It is model-free and DB-free,
so it runs as a normal vitest test and via `pnpm eval:governance`.

- The full `EffectCategory × TrustLevel` grid (7 × 3) is pinned to the decision
  the live gate returns (`auto-approve` / `require-approval` / `deny`).
- Override-resolution cases confirm `governanceOverride` wins where it applies
  and falls back to the base policy otherwise.
- A drift guard fails the test if core adds an effect category or trust level the
  grid doesn't cover.

This covers the **trust-tier** decision surface. Two governance facets are
**deferred** (documented in the spec): the trust-score→tier mapping
(`trustLevelFromScore`, thresholds ≥55/≥30 — currently private, needs a small
export) and PII-minimization / cross-tenant isolation (no pure, importable
decision function to oracle against without a live runtime / DB).

## 3. claim-classifier — staged boundary variants

`evals/claim-classifier/fixtures-candidate/boundary.jsonl` adds
ambiguous-boundary, negated, adversarial-false-positive, and code-switch (zh/ms)
variants. They are **structurally validated** by
`__tests__/fixtures-candidate.test.ts` but **not** auto-loaded by `run-eval.ts`
(the loader globs only `fixtures/*.jsonl`), so the required gate stays green until
they are promoted. Promotion (when credits exist): run live, recapture
`baseline.json`, move into `fixtures/` — see the harness README.

## Running it all

```bash
# Structural (no credits, no DB) — the same step CI runs:
pnpm exec vitest run --config evals/vitest.config.ts

# Deterministic governance matrix, standalone:
pnpm eval:governance

# Live, credit-gated (separate):
ANTHROPIC_API_KEY=... pnpm eval:classifier
ANTHROPIC_API_KEY=... pnpm eval:alex-conversation
```
