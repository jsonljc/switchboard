# Conversational Riley: design (read-only first; acting blocked on Tier 5)

> **Status: design only.** This document ships no code and prescribes no tests. It is the considered answer to the surface that Tier 4 PR 4.1 deleted (the dead Operator Chat widget): a real way to talk to the money agent, designed rather than resurrected. Implementation is **post-pilot** and split into a tractable read-only surface and an acting surface that is gated behind Tier 5.

- **Finding:** D8-2 (riley-remediation audit, `docs/audits/2026-06-10-riley-capability-audit/`). Riley has no conversational runtime; its ads tools and builders have zero production consumers.
- **Owning plan:** `docs/superpowers/plans/2026-06-10-riley-remediation-tier4-trust-surfaces.md` (PR 4.3).
- **Decision context:** the riley-remediation overview decision #3 removed the broken single-tenant Operator Chat relic rather than repairing it; this is the design for its right-shaped replacement.
- **References re-confirmed against `origin/main @ a909fa814` (2026-06-16).** Line numbers below are current; they drifted from the audit baseline because Tier 3 D3-1 (#1111) added to `skill-mode.ts`.

---

## 1. The surface (why it is worth designing)

"Talk to the money agent" is a north-star trust surface. An operator asks Riley in plain language:

- "why did you pause the Tuesday campaign?"
- "what would happen if I doubled the budget on the high-intent set?"
- "show me what's underperforming this week"

and Riley answers from real Meta data, with its real diagnosis, and (eventually) proposes a governed action the operator can approve in-thread.

This is the affordance the deleted Operator Chat widget gestured at ("pause low-performing ads") but never delivered: it posted to `POST /api/operator/command`, a route removed in `f5299e53`, so every message 404'd. Done right, "talk to Riley" is the single most legible "this agent is working for me" moment in the product. Done as a single-tenant HTTP relic, it is anti-trust, which is why PR 4.1 removed the old one rather than repairing it.

The trust comes from two properties the old widget lacked: the answers are grounded in the org's own live Meta data (not canned copy), and any action Riley proposes flows through the same governed approval path as the cron act-leg (no bypass).

---

## 2. The wiring (what exists, what is missing)

Riley already has the _pieces_ of a conversational runtime. They have **zero production consumers** today: they are wired into nothing but their own tests and the builder barrel.

### What exists

- **Tools** (`apps/api/src/tools/ad-optimizer/`):
  - `ads-analytics.ts` (`createAdsAnalyticsTool`): `diagnose`, `comparePeriods`, `analyzeFunnel`, `detectSaturation`, `analyzeCreatives`. Pure functions over `@switchboard/ad-optimizer`, **no external client deps**, `effectCategory:"read"`. Returns a `SkillTool`. This one is shippable as-is for a read-only surface.
  - `ads-data.ts` (`createAdsDataTool`): `get-campaign-insights`, account summary, CAPI dispatch. Needs an `adsClient`/`capiClient` (a live `MetaAdsClient`). Its insight ops are read-only; its CAPI op is a write and must be excluded from a read-only executor.
- **Builders** (`packages/core/src/skill-runtime/builders/`):
  - `ad-optimizer.ts` (`adOptimizerBuilder` + `AD_OPTIMIZER_CONTRACT`, a `BatchContextContract`).
  - `ad-optimizer-interactive.ts` (`adOptimizerInteractiveBuilder`).
  - Both are re-exported from `builders/index.ts` (lines 1-2) but **imported by no production code**; only the barrel and their own `__tests__` reference them.

### What is missing (by analogy to how alex + mira are mounted in `apps/api/src/bootstrap/skill-mode.ts`)

Today `loadSkill` is called only for `"alex"` (`skill-mode.ts:141`) and `"mira"` (`:146`); `registerSkillIntents` registers only those two (`:157`); and `executorBySlug` maps only `["creative", composeExecutor]` (`:829`). A conversational Riley needs four additions:

1. **Register the skill.** A `skills/riley/SKILL.md` whose frontmatter `slug` is the runtime identity matching Riley's seeded deployment `skillSlug` (`ad-optimizer`). It joins `skillsBySlug` and `registerSkillIntents`. Heed `feedback_skill_md_loader_traps`: dotted-triple body tokens break API boot via `validateToolReferences`; the frontmatter slug is the runtime identity (the directory name is cosmetic). Ship a real-file loader test when this is built.
2. **Register a Riley executor.** Add an `executorBySlug` entry keyed on `"ad-optimizer"`: a read-focused diagnose/explain executor mounting `createAdsAnalyticsTool` (and the read-only ops of `createAdsDataTool` with a live `MetaAdsClient`). The default conversation executor that alex rides is the starting point.
3. **Mount the builder + tools.** Pass `adOptimizerBuilder`/`adOptimizerInteractiveBuilder` to the `builderRegistry` and the ads tools to the executor's tool set, exactly as the alex/creative builders are registered today.
4. **Governance recipe.** Per `feedback_new_skill_intent_governance_recipe`, default-deny means a Riley skill needs a seeded anchored allow policy, an entitlement gate on every submit, and (for non-conversation surfaces) an `executorBySlug` entry. Tier 0's seeder already seeds Riley's deployment plus pause/handoff policies; a conversational Riley additionally needs its _conversation_ intent seeded so a fresh org can reach the surface.

---

## 3. The hard gotcha, and why this is L (not M)

A conversational Riley that only **reads** (diagnose, explain, compare) is tractable: the analytics tool is `effectCategory:"read"` and the data tool's insight ops are read-only. A conversational Riley that can **act** (pause a campaign, shift budget) collides head-on with the runtime's two-constraint-regime gap (`feedback_skill_runtime_two_constraint_regimes`):

- **The governance constraints do not bound the skill-mode executor loop.** `modes/skill-mode.ts` plumbs `constraints.trustLevel` into the executor's `execute()` call (`:93`), but the loop's turn budget and stop condition come from `DEFAULT_SKILL_RUNTIME_POLICY` (`maxLlmTurns`), a regime parallel to the `ExecutionConstraints` that `GovernanceGate` evaluates. So the governance object that gates a cron submit does not shape a conversational turn's execution envelope.
- **The `ModelRouter` is flag-gated, not wired for Riley.** It is resolved and passed into the main conversational executor only behind `ALEX_MODEL_ROUTER_ENABLED` (default off; `skill-mode.ts:682,702`); the simulation and compose executors pass `undefined` (`:742,:766`). So default turns are flat Sonnet, and a conversational Riley executor would have to opt the router in explicitly.
- **Mid-loop approval parking is structurally unrepresentable (the load-bearing gap).** Skill-mode has only `completed`/`failed` outcomes (`modes/skill-mode.ts:108`); a hook returning `pending_approval` mid-conversation is re-injected as tool output and the loop _continues_. There is no pause-and-resume ReAct. So a conversational Riley cannot say "I'd pause this, approve?" and actually park the action on the `WorkTrace` lifecycle the way the cron pause path does. Building that is a quarter-scale rebuild of the submission/parking lifecycle, the same gap Tier 5 must respect for autonomy. Of the three, this is the real blocker for an acting Riley: the other two are softer (a flag flip and an executor wiring choice), but parking requires a runtime that does not exist yet.

**Therefore the surface forks:**

- A **read-only** conversational Riley (answers questions, never mutates) is a real, shippable surface that does **not** need this gap closed. Recommended to ship first.
- An **acting** conversational Riley (proposes and parks governed actions in-thread) is blocked on closing the mid-loop-parking gap and must follow **Tier 5** (the act-leg prerequisites). It is not an incremental add to the read-only surface; it is the harder half.

This is why D8-2 is sized **L / post-pilot**: the read-only slice is moderate, but the acting slice is a runtime rebuild.

---

## 4. Test strategy (outline only)

When the read-only surface is scoped into its own plan, it should carry at least:

- **Loader pin.** A real-file `loadSkill("riley", ...)` test asserting the frontmatter slug equals the seeded deployment `skillSlug` (`ad-optimizer`) and that the `SKILL.md` body passes `validateToolReferences` at boot (`feedback_skill_md_loader_traps`).
- **Read-only executor.** An executor test (mirroring the alex/compose executor tests) that a "why is the Tuesday campaign underperforming?" turn invokes `ads-analytics.diagnose` against a fixture insight set and renders Riley's real diagnosis, with **no** mutating tool reachable. Assert the tool set the executor is constructed with contains only `read` ops (exclude the CAPI write op of `createAdsDataTool`).
- **Governance seam.** A provisioning/seed test that the Riley _conversation_ intent is seeded allow + entitlement-gated (the `feedback_new_skill_intent_governance_recipe` default-deny check), so a fresh org can actually reach the surface.
- **Act-leg explicitly deferred.** The acting/parking path is **not** tested in the read-only slice, because the runtime cannot represent it yet. No read-only test should exercise a mutate-and-park flow.

---

## 5. Dependencies and sequencing

- This document depends on **nothing** in the Tier 4 plan (it is a doc).
- The **read-only implementation** it describes depends on Tier 0 (a seeded Riley deployment plus a seeded Riley conversation intent and entitlement, so the surface is reachable). Ship this first.
- The **acting implementation** additionally depends on **Tier 5** (mid-loop parking / act-leg guards) and must not merge before Tier 5 is green, the same gate the cron act-leg already respects.

Recommended order: ship the read-only surface after Tier 0; gate the acting surface behind Tier 5.
