# ModelRouter Activation — Design

**Date:** 2026-06-01
**Status:** Approved
**Author:** Alex model-routing workstream

## Problem

Alex's per-turn model router is **built but dead in production.** `bootstrapSkillMode`
constructs the production `SkillExecutorImpl` with `undefined` for the `router` argument
(`apps/api/src/bootstrap/skill-mode.ts:550`), and `new ModelRouter(` appears nowhere in
`apps/`. So `SkillExecutorImpl.resolveProfile()` returns `undefined` for every turn
(`packages/core/src/skill-runtime/skill-executor.ts:143`), the adapter falls back to its
`DEFAULT_MODEL`, and **every Alex turn runs on Sonnet-4.6 with zero per-turn routing.**

The router itself is complete and tested:

- `ModelRouter.resolveTier()` (`packages/core/src/model-router.ts:95`) implements 6 rules:
  greeting → default, no-tools → default, prev-escalated → critical, prev-used-tools →
  premium, high-risk-tools → premium, else default; plus a `modelFloor` override.
- `SkillExecutorImpl` already calls `buildTierContext` → `resolveTier` → `resolve` whenever a
  router is present (`skill-executor.ts:137-164`).
- Tests exist: `packages/core/src/__tests__/model-router-tier.test.ts` (8 cases) and
  `packages/core/src/skill-runtime/__tests__/skill-executor-routing.test.ts` (router present /
  minimumModelTier / no-router fallback).

The gap is purely the **wiring** (Seam 1) and then the **stage-awareness** the router does not
yet have (Seam 2).

## Scope

Two PRs. PR1 makes the router real but inert; PR2 makes it smart.

### PR1 — Seam 1: Activate the router (flag-gated, default OFF)

**Goal:** `bootstrapSkillMode` instantiates a `ModelRouter` and passes it to the production
`SkillExecutorImpl`, behind an env flag defaulting to OFF. With the flag off, production
behavior is **byte-identical** to today (router `undefined` → adapter fallback). With it on,
the existing previous-turn tiering (`resolveTier` rules 1-6) begins to fire — Haiku on trivial
turns, premium/critical on tool/escalation turns.

**Why a flag, default OFF:** The `#672` Alex eval baseline (which would catch a quality dip)
is blocked on an external Anthropic billing top-up. The flag lets PR1 merge now with zero prod
behavior change, then be flipped in Vercel once the baseline is locked — honoring the
"coordinate before merging" constraint without leaving dead code on `main`. This turns the
current "router is always `undefined`" silent bug into an **explicit, tested decision.**

**Changes:**

1. **New testable seam** `apps/api/src/bootstrap/model-router-factory.ts`:

   ```ts
   export function resolveModelRouter(
     flagValue: string | undefined = process.env.ALEX_MODEL_ROUTER_ENABLED,
   ): ModelRouter | undefined {
     return flagValue === "true" ? new ModelRouter() : undefined;
   }
   ```

   The flag-value param defaults from the literal `process.env.ALEX_MODEL_ROUTER_ENABLED`
   (which `scripts/check-env-completeness.ts` greps for, so the var is detected and must be
   categorized) while keeping the unit test pure — it injects the string directly with no
   `process.env` mutation. Co-located `model-router-factory.test.ts` is the regression test:
   flag unset (`undefined`) → `undefined`, `"false"`/other → `undefined`, `"true"` →
   `ModelRouter` instance. This guards the exact decision that was previously a hardcoded
   `undefined`.

2. **`apps/api/src/bootstrap/skill-mode.ts`:** import `ModelRouter` from `@switchboard/core`
   and `resolveModelRouter` from the factory; replace the `undefined` at the production
   executor (`:550`) with `resolveModelRouter()`. A startup log line records whether routing is
   enabled. The **simulation executor (`:680`) is left on the fallback** — out of scope for
   PR1. (Note: `/simulate` IS live and executes the LLM per turn; the "no `workUnitId`"
   inertness belongs to the _delegate tool_, which is separately excluded from simulation, not
   to the executor.) Consequence, documented as an accepted limitation: once the flag is
   flipped on, `/simulate` will preview the adapter default model while production tiers
   per-turn. Routing the simulation executor for preview fidelity is a deliberate follow-up,
   not part of PR1.

3. **Env plumbing:** add `ALEX_MODEL_ROUTER_ENABLED` to
   `scripts/env-allowlist.local-readiness.json` (CI lint + test both fail on an uncategorized
   env var) and document it in `.env.example` (default `false`).

**Acceptance:** flag off ⇒ no `ModelRouter` constructed, prod path unchanged. Flag on ⇒ the
production `SkillExecutorImpl` receives a `ModelRouter`. New factory test passes; existing
executor-routing and tier tests stay green. `pnpm --filter api test`, `typecheck`,
`format:check` clean.

### PR2 — Seam 2: Stage-aware tiering

**Goal:** Raise the model tier for high-stakes conversational moments using the existing
LLM-free emotional classifier as the signal source. **Only ever raises** the tier — never
downgrades a path — so risk is strictly lower-bounded.

**Independence note (must be explicit in the PR description):** PR2 compiles and its tests pass
**independently** of PR1 (the `model-router.ts` changes are additive and the executor change is
guarded by `if (!this.router) return undefined`). But it has **no runtime effect** until PR1
wires the router AND `ALEX_MODEL_ROUTER_ENABLED` is enabled. File sets are disjoint from PR1,
so the two branches do not conflict and need no stacking.

**Stage derivation (Balanced mapping):** A pure function maps an `EmotionalSignal` to a
`DialogueStage`:

| Signal                                             | Stage       | Tier               |
| -------------------------------------------------- | ----------- | ------------------ |
| `concernType === "fear"`                           | `fear`      | `critical` (Opus)  |
| `urgencySignal === "ready_now"`                    | `closing`   | `premium` (Sonnet) |
| `concernType ∈ {price, trust, timing, comparison}` | `objection` | `premium` (Sonnet) |
| otherwise                                          | _(none)_    | _(rules decide)_   |

Derivation precedence: **fear → closing → objection** (first match wins). The classifier's own
`concernType` precedence is `price > trust > timing > fear > comparison` (else-if chain), so a
mixed message like _"scared the **price** is too high"_ is classified `concernType: "price"` →
`objection` → **premium**, NOT `critical`. Only a message with no price/trust/timing match that
hits a fear pattern (e.g. _"terrified of the pain"_) reaches `fear` → `critical`. This bounds
the cost of the fear→critical rule and is asserted by explicit tests.

**Changes:**

1. **`packages/core/src/model-router.ts`:**
   - `export type DialogueStage = "objection" | "closing" | "fear";`
   - Add `currentStage?: DialogueStage` to `TierContext`.
   - In `resolveTier`: compute the existing rule-based slot, then take
     `maxSlot(ruleSlot, stageToSlot(currentStage))`, then `applyFloor`. `stageToSlot`:
     fear → critical, objection/closing → premium, undefined → undefined. Because the merge is
     a rank-max and the stage slot is undefined when `currentStage` is unset, **all 8 existing
     tier tests remain green** and no path is ever downgraded.

2. **`packages/core/src/dialogue/dialogue-stage.ts` (new):**
   `emotionalSignalToStage(signal: EmotionalSignal): DialogueStage | undefined`, per the table
   above. Co-located `dialogue-stage.test.ts`. Exported from the core barrel.

3. **`packages/core/src/skill-runtime/skill-tier-context-builder.ts`:** add
   `currentStage?: DialogueStage` to `TierContextInput` and pass it onto the returned
   `TierContext`. **Stays pure** — it does NOT import the classifier; classification remains in
   the executor layer so tiering stays deterministic and unit-testable.

4. **`packages/core/src/skill-runtime/skill-executor.ts` (`resolveProfile`, ~3-5 lines):**
   extract the latest user message from `params.messages`, call `classifyEmotionalSignal`
   (pure/sync/deterministic — regex only, no LLM), derive `currentStage` via
   `emotionalSignalToStage`, and thread it into `buildTierContext`. Runs only when a router is
   present (the method already returns early otherwise), so there is **zero overhead when the
   flag is off.** The executor file is already 473 lines (400 warn / 600 error), so the change
   is deliberately minimal and the mapping lives in its own module.

**Defensive latest-message extraction** (explicit tests for each):

- no messages → `currentStage: undefined`
- last message is `assistant` (no trailing user message) → scan back for the last `user`
  message; if none, `undefined`
- empty / whitespace-only user text → classifier returns no concern → `undefined`

**Acceptance / tests:**

- `dialogue-stage.test.ts`: fear / closing / objection / none / precedence (fear-before-price
  mixed case).
- `model-router-tier.test.ts` (extended): objection → premium, closing → premium, fear →
  critical; stage never lowers (e.g. `previousTurnEscalated` critical + objection stays
  critical); greeting (`messageIndex 0`) + fear → critical (max raises above default);
  `modelFloor` interaction unchanged.
- `skill-tier-context-builder.test.ts` (extended): `currentStage` threads through.
- `skill-executor-routing.test.ts` (extended): **full-chain integration** — router present +
  latest user message `"can I book now"` (`ready_now`) → `closing` → profile model
  `claude-sonnet-4-6`; and `"I'm terrified of the pain"` → `fear` → `claude-opus-4-6`; plus the
  defensive cases. Existing three cases stay green (the `"test"` message yields no concern →
  default).

## Risks & Mitigations

1. **PR2 independent-branch / runtime-dependency confusion** → PR description states explicitly
   it is inert until PR1 + flag.
2. **Classifier on the hot path** → it is pure synchronous regex, and only invoked when a
   router exists (flag on). A unit assertion keeps it free of `await`/LLM.
3. **Brittle latest-message extraction** → defensive handling + per-case tests (above).
4. **fear→critical over-routing** → bounded by the classifier's `price`-before-`fear`
   precedence; asserted by the mixed-message test so the bound cannot silently regress.

## Rollout / Merge Order

1. Merge **PR1**.
2. Deploy with `ALEX_MODEL_ROUTER_ENABLED` unset/false; confirm prod behavior unchanged.
3. Merge **PR2**.
4. Flip the flag to `true` only after the `#672` eval baseline is stable, so a quality dip is
   measurable.

## Out of Scope

- Wiring the router into the simulation executor.
- Changing the model IDs in `SLOT_CONFIGS` (critical is `claude-opus-4-6` today).
- The `#672` eval baseline itself (externally blocked on billing) and `#673` classifier
  over-flag tuning.
