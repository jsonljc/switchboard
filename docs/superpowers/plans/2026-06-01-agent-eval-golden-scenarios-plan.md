# Agent Eval Golden-Scenario Regression Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand agent eval coverage from 8 thin fixtures into a generated, oracle-backed golden-scenario regression suite plus a deterministic governance-decision matrix and staged classifier boundary variants.

**Architecture:** Additive, backward-compatible extension of the existing `evals/` harnesses. A pure `evaluateOracle()` checker + optional fixture `oracle` block (alex), a model-free/DB-free matrix over the live `getToolGovernanceDecision` gate (governance), and staged structurally-validated classifier rows. No gate flips; structural validation runs in CI today, live scoring is credit-gated.

**Tech Stack:** TypeScript (ESM), Zod, Vitest, tsx, `@switchboard/core/skill-runtime`.

**Spec:** `docs/superpowers/specs/2026-06-01-agent-eval-golden-scenarios-design.md`
**Branch:** `feat/agent-eval-golden-scenarios`
**Approach:** TDD (failing test → implement) for all pure/structural units. Scenario generation fanned out via a dynamic Workflow, then validated structurally. No gate flips. No live-model runs required for the deliverable.

## Conventions (apply throughout)

- ESM, `.js` extensions in relative imports; double quotes, semi, 2-space, 100-col (prettier).
- No `any`, no `console.log`. Co-located `*.test.ts`. Files < 400 lines (split if larger).
- Before every commit: `git branch --show-current` + `git status --short`; run `pnpm format:check` (CI lint runs prettier), the relevant `vitest`, and `pnpm typecheck` for touched packages.
- commitlint subject lowercase.
- Each phase = its own focused commit.

## Phase 0 — Verify-and-adapt (no code, ~5 min)

Re-confirm the exact API surface before coding (some earlier reads were unreliable). Capture verbatim:

1. `packages/core/src/skill-runtime/governance.ts`: exact name/signature of the decision function (`getToolGovernanceDecision`), the `GOVERNANCE_POLICY` table, and the source + members of `EffectCategory`, `TrustLevel`, `GovernanceDecision`.
2. `packages/core/src/index.ts`: are the above exported from the barrel? Is there `export * from "./skill-runtime/governance.js"`?
3. `trustLevelFromScore` location + thresholds + export status.
4. `evals/vitest.config.ts` `test.include` glob → confirm new `evals/<dir>/__tests__/*.test.ts` auto-discovers.
5. `evals/claim-classifier/load-fixtures.ts` glob → confirm a sibling `fixtures-candidate/` dir is NOT auto-loaded; `FixtureRowSchema` exact shape.
6. `evals/alex-conversation/run-conversation.ts` captured tool-call entry shape (expect `{toolId, operation}`).

**Adapt rule:** if the live gate is named differently or not exported, (a) prefer the genuinely-live function, (b) add a minimal barrel export + the missing co-located unit test. If `trustLevelFromScore` lives in `platform/` and isn't exported, export it (it now has eval coverage).

**Success:** a short notes block (kept in the PR description) with the confirmed signatures.

## Phase 1 — Alex oracle layer (TDD) → commit `feat(evals): alex-conversation oracle layer`

### 1a. Schema extension — `evals/alex-conversation/schema.ts`

Add **optional** fields to `ConversationFixtureSchema` (backward compatible; existing 8 fixtures still parse):

- `stage: z.enum([...9 stages]).optional()`
- `tags: z.array(z.string()).default([])`
- `oracle: ConversationOracleSchema.optional()` (imported from `./oracle.js`)

### 1b. `evals/alex-conversation/oracle.ts` (NEW)

- `ALLOWED = ["crm-query","crm-write","calendar-book","escalate"]` — import the existing `ALEX_ALLOWED_TOOL_IDS` from `./grade.js` (single source of truth; do not duplicate).
- `ConversationOracleSchema` (Zod) with refinements:
  - `expectedTools?: AllowedToolId[]`, `forbiddenTools?: AllowedToolId[]`, `expectsEscalation?: boolean`, `expectsBooking?: boolean`.
  - refine: `expectedTools ⊆ ALLOWED`, `forbiddenTools ⊆ ALLOWED`, `expectedTools ∩ forbiddenTools = ∅`.
  - refine: `expectsEscalation === true ⇒ "escalate" ∉ forbiddenTools`.
  - refine: `expectsBooking === true ⇒ "calendar-book" ∉ forbiddenTools`; `expectsBooking === false ⇒ "calendar-book" ∉ expectedTools`.
- `evaluateOracle(toolCalls: ReadonlyArray<{ toolId: string }>, oracle: ConversationOracle): { pass: boolean; violations: OracleViolation[] }` — pure, total. Codes: `missing-expected-tool:<id>`, `forbidden-tool-called:<id>`, `expected-escalation-missing`, `unexpected-escalation`, `expected-booking-missing`, `unexpected-booking`.
  - `expectsBooking:false` ⇒ if `calendar-book` called → `unexpected-booking`.
  - `expectsEscalation:false` ⇒ if `escalate` called → `unexpected-escalation`.

### 1c. TDD tests — `evals/alex-conversation/__tests__/oracle.test.ts` (NEW, write FIRST)

- Empty/undefined oracle ⇒ pass, no violations.
- Each violation code triggered by a minimal tool-call list.
- Well-formedness: schema rejects out-of-allowlist tools, overlapping expected/forbidden, escalate-in-forbidden-with-expectsEscalation-true.
- Multiple tool calls of same id count once for presence.

### 1d. Wire into runner — `evals/alex-conversation/run-eval.ts`

- After `gradeDeterministic`, if `fixture.oracle` present, run `evaluateOracle` over the union of `toolCalls` across the scenario's captured turns; fold oracle violations into the scenario `violations` and AND into `deterministicPass`. Guard so absent oracle = unchanged behavior.
- (This only affects live runs; structural CI is unaffected.)

**Success:** `pnpm exec vitest run --config evals/vitest.config.ts evals/alex-conversation/__tests__/oracle.test.ts` green; `pnpm typecheck` (evals) clean; existing 8 fixtures still parse.

## Phase 2 — Governance-decision mini-matrix (TDD) → commit `feat(evals): governance-decision matrix`

### 2a. `evals/governance-decision/schema.ts` (NEW)

`GovernanceCaseSchema` = discriminated union on `kind`:

- `kind:"tool-decision"`: `{ id, effectCategory, trustLevel, operationGovernanceOverride?, expectedDecision, notes? }`.
- `kind:"trust-score"`: `{ id, score, expectedTier, notes? }`.
  Enums mirror the confirmed core types (Phase 0).

### 2b. `evals/governance-decision/load-fixtures.ts` + `fixtures/*.jsonl` (NEW)

- `policy-grid.jsonl`: full EffectCategory × TrustLevel grid (21 cases) with `expectedDecision` taken from the real `GOVERNANCE_POLICY` table.
- `overrides.jsonl`: override forces decision regardless of base cell.
- `trust-score.jsonl`: boundaries 0/29/30/31/54/55/56/100.

### 2c. `evals/governance-decision/run-eval.ts` (NEW)

Deterministic runner: import `getToolGovernanceDecision` + `trustLevelFromScore` from `@switchboard/core`; for each case assert `expected === actual`; print a diff table; exit non-zero on mismatch. No API key, no DB.

### 2d. TDD test — `evals/governance-decision/__tests__/governance-decision.test.ts` (NEW, write FIRST)

- Loads fixtures, runs each case through the real gate, asserts match. (The test IS the oracle: a wrong expectation fails loudly.)
- `schema.test.ts`: fixture shape + unique ids + enum coverage (every EffectCategory and TrustLevel appears).

### 2e. Co-located core unit test — `packages/core/src/skill-runtime/governance.test.ts` (NEW if missing)

Direct unit tests for `getToolGovernanceDecision` (CLAUDE.md requires co-located tests; the live gate currently may lack them). Keep minimal; the eval matrix is the broad coverage.

### 2f. Barrel export (if Phase 0 shows missing)

Add `export { getToolGovernanceDecision, GOVERNANCE_POLICY } ...` + types, and `trustLevelFromScore`, to `packages/core/src/index.ts`. Rebuild core (`pnpm --filter @switchboard/core build`) so evals resolve it.

**Success:** governance-decision vitest green locally (genuine, deterministic — not just structural); `pnpm --filter @switchboard/core test` green; typecheck clean.

## Phase 3 — Generate alex golden + edge scenarios (Workflow) → commit `feat(evals): golden + edge alex scenarios`

### 3a. Generation (dynamic Workflow)

Fan out subagents, each authoring a batch of fixtures for one matrix cell (stage × locale × concern), returning an array of fixture objects validated against the (now-extended) schema shape. Cells:

- full-arc (sg, my) ×2–3 each
- objection: price / results-skepticism / safety / time / credentials / comparison (sg+my)
- qualification, booking, post-booking, reactivation, refusal/out-of-scope
- escalation-required (medical red flag, explicit human request) — `expectsEscalation:true`
- do-not-book guardrails — `forbiddenTools:["calendar-book"]` / `expectsBooking:false`
- tool-error recovery, code-switch (zh/Singlish/Manglish)

Each fixture MUST: realistic SG/MY medspa content; correct `grade` hints (mustAsk/mustDo/mustNot/shouldDo) consistent with the judge rubric (no guarantees/diagnosis/pressure/book-before-qualified); a well-formed `oracle`; a `stage` + `tags`.

### 3b. Validation + integration (Workflow stage + local)

- Structural validator subagents parse each candidate against the schema + `evaluateOracle` well-formedness; drop/repair failures.
- Dedupe by id and by near-duplicate scenario text.
- Write one `.jsonl` per scenario into `evals/alex-conversation/fixtures/` following existing naming (kebab id == filename stem).
- A completeness critic pass: "which matrix cells are thin/missing?" → top-up.

### 3c. `evals/alex-conversation/__tests__/matrix.test.ts` (NEW)

Assert coverage bounds (≥60, ≤95), per-stage ≥3, ≥8 per locale, ≥6 full-arc, ≥6 expectsEscalation, ≥6 forbidden-calendar-book, unique ids, every fixture passes `ConversationFixtureSchema`, every `oracle` well-formed.

**Success:** `pnpm exec vitest run --config evals/vitest.config.ts evals/alex-conversation` green (all fixtures load + matrix satisfied) with NO API key.

## Phase 4 — Classifier boundary variants (structural) → commit `feat(evals): classifier boundary variants (staged)`

### 4a. `evals/claim-classifier/fixtures-candidate/boundary.jsonl` (NEW, staged)

~15–20 rows: ambiguous-boundary (with `acceptableClaimTypes`), negated→`none`, adversarial-false-positive→`none`, code-switch (zh/ms). Correct ground-truth labels; `notes` flag which probe over-flagging.

### 4b. `evals/claim-classifier/__tests__/fixtures-candidate.test.ts` (NEW)

Structural validation: each row parses `FixtureRowSchema`; unique ids; `expectedClaimType` + `acceptableClaimTypes ⊆` enum; valid `language`/`jurisdiction`. Confirms loader does NOT pick up the candidate dir (so the required gate stays green).

### 4c. `evals/claim-classifier/README.md` (EDIT)

Document the candidate dir + promotion path (run live → `--write-baseline` → move to `fixtures/`).

**Success:** candidate test green; existing classifier gate untouched (loader still globs only `fixtures/*.jsonl`).

## Phase 5 — Docs + CI wiring → commit `docs(evals): suite overview + ci wiring`

### 5a. `docs/agent-eval-golden-scenarios.md` (NEW)

Suite overview: taxonomy, oracle format, structural-vs-live status table, governance-decision harness, classifier candidates, promotion paths. Cross-link the spec.

### 5b. `evals/alex-conversation/README.md` (EDIT)

Document `stage`/`tags`/`oracle` and the oracle gate.

### 5c. CI (`.github/workflows/ci.yml`)

- Ensure the governance-decision deterministic test runs in CI. If `evals/vitest.config.ts` already globs all `evals/**`, the existing "Run eval unit tests" step covers it — just add `evals/governance-decision/**` and `evals/claim-classifier/fixtures-candidate/**` to the relevant `paths` filters. If the vitest config is dir-scoped, broaden it to include the new dir.
- Add a root script `eval:governance` (`tsx evals/governance-decision/run-eval.ts`) for local/manual runs.
- **Do NOT** change `continue-on-error` on alex-conversation. Add a comment noting the promotion criteria.

**Success:** `pnpm exec vitest run --config evals/vitest.config.ts` runs ALL new tests green; `pnpm format:check` clean; full `pnpm typecheck` clean.

## Phase 6 — Full verification + review → PR

1. `pnpm exec vitest run --config evals/vitest.config.ts` (all eval unit tests).
2. `pnpm --filter @switchboard/core test` (governance unit test).
3. `pnpm typecheck` (touched packages); `pnpm format:check`.
4. Run `evals/governance-decision/run-eval.ts` locally → genuine green.
5. Invoke the code-review skill (3-lens whole-PR review); address findings.
6. Open PR. Body states exactly what was validated **structurally** (alex fixtures, oracle well-formedness, classifier candidates) vs **executed** (governance matrix — genuinely run, deterministic) vs **deferred to live/credit-gated** (alex live scoring + baseline capture, classifier live scoring + baseline recapture). Document every design decision + the PII/cross-tenant deferrals.

## Risks (carried from spec §9)

Staged classifier dir protects the required gate; optional oracle keeps existing fixtures intact; deterministic governance harness needs no credits; live alex cost is informational + maintainer-triggered.
