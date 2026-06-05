# ModelRouter Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Alex's built-but-dead `ModelRouter` on in production behind a default-off flag (PR1), then make it stage-aware off the LLM-free emotional classifier (PR2).

**Architecture:** PR1 adds a tiny flag-gated factory (`resolveModelRouter`) and passes its result into the production `SkillExecutorImpl` (replacing a hardcoded `undefined`). PR2 adds a `DialogueStage` dimension to `TierContext`/`resolveTier` (rank-max merge so it only ever raises the tier), a pure `emotionalSignalToStage` mapper, threads `currentStage` through `buildTierContext`, and calls the classifier per-turn in the executor.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Vitest, pnpm + Turborepo. `packages/core` (layer 3) and `apps/api` (layer 5).

**Spec:** `docs/superpowers/specs/2026-06-01-model-router-activation-design.md`

**Worktrees:**

- PR1 → `feat/model-router-wire` at `.claude/worktrees/model-router-wire` (already created, built).
- PR2 → `feat/model-router-stage-aware` at `.claude/worktrees/model-router-stage-aware` (create in Task 5, off `origin/main`). Disjoint files from PR1 — no stacking.

**Commit footer for every commit:**

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

# PR1 — Seam 1: Activate the router (flag-gated, default OFF)

All PR1 work happens in `.claude/worktrees/model-router-wire`.

### Task 1: `resolveModelRouter` factory

**Files:**

- Create: `apps/api/src/bootstrap/model-router-factory.ts`
- Test: `apps/api/src/bootstrap/model-router-factory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/bootstrap/model-router-factory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ModelRouter } from "@switchboard/core";
import { resolveModelRouter } from "./model-router-factory.js";

describe("resolveModelRouter", () => {
  it("returns undefined when the flag is unset (undefined)", () => {
    expect(resolveModelRouter(undefined)).toBeUndefined();
  });

  it("returns undefined when the flag is 'false'", () => {
    expect(resolveModelRouter("false")).toBeUndefined();
  });

  it("returns undefined for any non-'true' value", () => {
    expect(resolveModelRouter("1")).toBeUndefined();
    expect(resolveModelRouter("yes")).toBeUndefined();
    expect(resolveModelRouter("TRUE")).toBeUndefined();
  });

  it("returns a ModelRouter only when the flag is exactly 'true'", () => {
    expect(resolveModelRouter("true")).toBeInstanceOf(ModelRouter);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/model-router-factory.test.ts`
Expected: FAIL — cannot resolve `./model-router-factory.js` / `resolveModelRouter is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/bootstrap/model-router-factory.ts`:

```ts
import { ModelRouter } from "@switchboard/core";

/**
 * Flag-gated construction of the per-turn model router for Alex.
 *
 * Returns a `ModelRouter` only when `ALEX_MODEL_ROUTER_ENABLED === "true"`,
 * otherwise `undefined` — in which case `SkillExecutorImpl.resolveProfile()`
 * returns `undefined` and the adapter falls back to its default model
 * (production behavior is byte-identical to before the router was wired).
 *
 * The flag-value parameter defaults from the literal
 * `process.env.ALEX_MODEL_ROUTER_ENABLED` so `scripts/check-env-completeness.ts`
 * (which greps `process.env.FOO`) detects the variable, while unit tests stay
 * pure by injecting the string directly.
 */
export function resolveModelRouter(
  flagValue: string | undefined = process.env.ALEX_MODEL_ROUTER_ENABLED,
): ModelRouter | undefined {
  return flagValue === "true" ? new ModelRouter() : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/api exec vitest run src/bootstrap/model-router-factory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/model-router-factory.ts apps/api/src/bootstrap/model-router-factory.test.ts
git commit -m "feat(api): flag-gated resolveModelRouter factory (default off)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire the factory into the production executor

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts` (top static imports; production executor at ~`:547`)

- [ ] **Step 1: Add the static import**

Near the other top-of-file static imports (after `import { isNoopCalendarProvider } from "./noop-calendar-provider.js";` at line ~19), add:

```ts
import { resolveModelRouter } from "./model-router-factory.js";
```

- [ ] **Step 2: Replace the hardcoded `undefined` and add a startup log**

Find the production executor construction (currently):

```ts
const skillExecutor = new SkillExecutorImpl(
  adapter,
  toolsMap,
  undefined,
  hooks,
  undefined,
  toolFactories,
  qualificationEvaluationHook,
);
```

Replace with:

```ts
const modelRouter = resolveModelRouter();
logger.info(
  modelRouter
    ? "ModelRouter ENABLED — per-turn model tiering active for Alex"
    : "ModelRouter disabled (set ALEX_MODEL_ROUTER_ENABLED=true to enable) — adapter default model in use",
);
const skillExecutor = new SkillExecutorImpl(
  adapter,
  toolsMap,
  modelRouter,
  hooks,
  undefined,
  toolFactories,
  qualificationEvaluationHook,
);
```

Leave the simulation executor at `:680` unchanged (still `undefined` — out of scope).

- [ ] **Step 3: Typecheck the app**

Run: `pnpm --filter @switchboard/api typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Run the api test suite (no regressions)**

Run: `pnpm --filter @switchboard/api test`
Expected: PASS — existing suites unchanged, factory test green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts
git commit -m "feat(api): wire ModelRouter into production SkillExecutor via flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Env plumbing (allowlist + .env.example)

**Files:**

- Modify: `scripts/env-allowlist.local-readiness.json`
- Modify: `.env.example`

- [ ] **Step 1: Add the var to the allowlist (alphabetical position)**

In `scripts/env-allowlist.local-readiness.json`, inside `required_in_env_example`, insert
`"ALEX_MODEL_ROUTER_ENABLED",` between `"ALERT_WEBHOOK_URL"` and `"ALLOW_SELF_APPROVAL"`:

```json
    "ALERT_WEBHOOK_URL",
    "ALEX_MODEL_ROUTER_ENABLED",
    "ALLOW_SELF_APPROVAL",
```

- [ ] **Step 2: Add the var to `.env.example`**

After the Riley flag block (lines ~301-302), append:

```
# Alex per-turn model router kill-switch. Default false until the #672 eval
# baseline is locked; flip to true to enable Haiku/Sonnet/Opus per-turn tiering.
ALEX_MODEL_ROUTER_ENABLED=false
```

- [ ] **Step 3: Run the env-completeness check**

Run: `pnpm exec tsx scripts/check-env-completeness.ts`
Expected: `✓ env-example completeness OK` (exit 0). If it reports `ALEX_MODEL_ROUTER_ENABLED` uncategorized or missing-from-example, the entry is in the wrong file/section — fix and re-run.

- [ ] **Step 4: Commit**

```bash
git add scripts/env-allowlist.local-readiness.json .env.example
git commit -m "chore(env): document ALEX_MODEL_ROUTER_ENABLED flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: PR1 full verification

**Files:** none (verification only)

- [ ] **Step 1: Core tests (router/executor untouched but confirm green)**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS — including `model-router-tier.test.ts` and `skill-executor-routing.test.ts`.

- [ ] **Step 2: Typecheck api + core**

Run: `pnpm --filter @switchboard/api typecheck && pnpm --filter @switchboard/core typecheck`
Expected: PASS.

- [ ] **Step 3: Format check (CI runs prettier; local lint does not)**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format` and re-stage.

- [ ] **Step 4: Confirm prod is byte-identical when flag off (manual reasoning + grep)**

Run: `git grep -n "resolveModelRouter\|ALEX_MODEL_ROUTER_ENABLED" apps/api/src`
Confirm: the only `resolveModelRouter()` call site is the production executor; with the flag unset it returns `undefined`, so `SkillExecutorImpl` receives `undefined` exactly as before.

PR1 is ready for the verify + review + open-PR task (see "PR1 Review & Open" below).

---

# PR2 — Seam 2: Stage-aware tiering

All PR2 work happens in a **new** worktree off `origin/main` (disjoint files from PR1).

### Task 5: Create the PR2 worktree + `emotionalSignalToStage` mapper

**Files:**

- Create: `packages/core/src/dialogue/dialogue-stage.ts`
- Test: `packages/core/src/dialogue/dialogue-stage.test.ts`

- [ ] **Step 1: Create the worktree and build deps**

From the main repo root (`/Users/jasonli/switchboard`):

```bash
git worktree add -b feat/model-router-stage-aware .claude/worktrees/model-router-stage-aware origin/main
cd .claude/worktrees/model-router-stage-aware
bash scripts/setup-env.sh
pnpm install
pnpm --filter "@switchboard/core..." build
```

Expected: core + its deps build "Done". (apps/chat build is pre-existing-broken on main and irrelevant here.)

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/dialogue/dialogue-stage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emotionalSignalToStage } from "./dialogue-stage.js";
import type { EmotionalSignal } from "./types.js";

function signal(overrides: Partial<EmotionalSignal> = {}): EmotionalSignal {
  return {
    valence: "neutral",
    engagement: "medium",
    intentClarity: "clear",
    concernType: "none",
    urgencySignal: "none",
    localMarker: "none",
    confidence: 0.5,
    ...overrides,
  };
}

describe("emotionalSignalToStage", () => {
  it("maps a fear concern to the fear stage", () => {
    expect(emotionalSignalToStage(signal({ concernType: "fear" }))).toBe("fear");
  });

  it("maps ready_now urgency to the closing stage", () => {
    expect(emotionalSignalToStage(signal({ urgencySignal: "ready_now" }))).toBe("closing");
  });

  it("maps price / trust / timing / comparison concerns to the objection stage", () => {
    for (const concernType of ["price", "trust", "timing", "comparison"] as const) {
      expect(emotionalSignalToStage(signal({ concernType }))).toBe("objection");
    }
  });

  it("returns undefined when there is no escalating signal", () => {
    expect(emotionalSignalToStage(signal())).toBeUndefined();
    expect(emotionalSignalToStage(signal({ urgencySignal: "exploring" }))).toBeUndefined();
  });

  it("prefers fear over closing when both are present", () => {
    expect(
      emotionalSignalToStage(signal({ concernType: "fear", urgencySignal: "ready_now" })),
    ).toBe("fear");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core exec vitest run src/dialogue/dialogue-stage.test.ts`
Expected: FAIL — cannot resolve `./dialogue-stage.js`.

- [ ] **Step 4: Write minimal implementation**

Create `packages/core/src/dialogue/dialogue-stage.ts`:

```ts
import type { DialogueStage } from "../model-router.js";
import type { EmotionalSignal } from "./types.js";

/**
 * Derive a coarse dialogue stage from an emotional signal, used by the model
 * router to raise the tier on high-stakes turns. Precedence is
 * fear → closing → objection (first match wins); `undefined` means "no
 * escalating signal — let the previous-turn rules decide".
 *
 * Pure and deterministic — no I/O. The `fear` branch is bounded by the
 * classifier's own concern precedence (price > trust > timing > fear), so a
 * price-laden message never reaches `fear`.
 */
export function emotionalSignalToStage(signal: EmotionalSignal): DialogueStage | undefined {
  if (signal.concernType === "fear") return "fear";
  if (signal.urgencySignal === "ready_now") return "closing";
  if (
    signal.concernType === "price" ||
    signal.concernType === "trust" ||
    signal.concernType === "timing" ||
    signal.concernType === "comparison"
  ) {
    return "objection";
  }
  return undefined;
}
```

Note: `DialogueStage` does not exist yet (added in Task 6). This file will not typecheck until Task 6 lands — that is expected; the vitest run in Step 3/5 transpiles per-file and the type import is erased, so the test still runs. (If your environment fails on the missing type, do Task 6 Step 4 first, then return here.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core exec vitest run src/dialogue/dialogue-stage.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/dialogue/dialogue-stage.ts packages/core/src/dialogue/dialogue-stage.test.ts
git commit -m "feat(core): emotionalSignalToStage dialogue-stage mapper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `DialogueStage` + stage-aware `resolveTier`

**Files:**

- Modify: `packages/core/src/model-router.ts`
- Test: `packages/core/src/__tests__/model-router-tier.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/model-router-tier.test.ts` (inside the existing `describe`):

```ts
it("Stage: objection raises a no-tools turn to premium", () => {
  expect(router.resolveTier(ctx({ toolCount: 0, currentStage: "objection" }))).toBe("premium");
});

it("Stage: closing raises a no-tools turn to premium", () => {
  expect(router.resolveTier(ctx({ toolCount: 0, currentStage: "closing" }))).toBe("premium");
});

it("Stage: fear raises to critical", () => {
  expect(router.resolveTier(ctx({ toolCount: 0, currentStage: "fear" }))).toBe("critical");
});

it("Stage: fear raises even the first-message greeting to critical", () => {
  expect(router.resolveTier(ctx({ messageIndex: 0, currentStage: "fear" }))).toBe("critical");
});

it("Stage never lowers: escalated + objection stays critical", () => {
  expect(router.resolveTier(ctx({ previousTurnEscalated: true, currentStage: "objection" }))).toBe(
    "critical",
  );
});

it("Stage + floor: premium floor + fear → critical", () => {
  expect(router.resolveTier(ctx({ modelFloor: "premium", currentStage: "fear" }))).toBe("critical");
});
```

(The shared `ctx()` helper already spreads `...overrides`, so `currentStage` flows through once the field exists.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core exec vitest run src/__tests__/model-router-tier.test.ts`
Expected: FAIL — `currentStage` is not a known property of `TierContext` (type error) and/or the stage cases resolve to `default`.

- [ ] **Step 3: Add the `DialogueStage` type and `currentStage` field**

In `packages/core/src/model-router.ts`, after the `ModelSlot` type (line ~3) add:

```ts
export type DialogueStage = "objection" | "closing" | "fear";
```

In the `TierContext` interface, add the field (after `modelFloor`):

```ts
  modelFloor?: ModelSlot;
  /** Coarse dialogue stage derived from the latest user message. Only ever
   * raises the resolved tier (never lowers). */
  currentStage?: DialogueStage;
```

- [ ] **Step 4: Make `resolveTier` stage-aware via rank-max merge**

Replace the body of `resolveTier` and add two private helpers:

```ts
  resolveTier(context: TierContext): ModelSlot {
    let slot: ModelSlot;
    if (context.messageIndex === 0)
      slot = "default"; // Rule 1: greetings
    else if (context.toolCount === 0)
      slot = "default"; // Rule 2: conversational
    else if (context.previousTurnEscalated)
      slot = "critical"; // Rule 3: escalation
    else if (context.previousTurnUsedTools)
      slot = "premium"; // Rule 4: tool follow-up
    else if (context.hasHighRiskTools)
      slot = "premium"; // Rule 5: high risk
    else slot = "default"; // Rule 6: default

    // Stage-aware escalation: take the higher of the rule slot and the stage
    // slot so a high-stakes turn (objection/closing/fear) is never under-served,
    // and no path is ever downgraded.
    const stageSlot = this.stageToSlot(context.currentStage);
    if (stageSlot) slot = this.maxSlot(slot, stageSlot);

    return this.applyFloor(slot, context.modelFloor);
  }

  private stageToSlot(stage?: DialogueStage): ModelSlot | undefined {
    switch (stage) {
      case "fear":
        return "critical";
      case "objection":
      case "closing":
        return "premium";
      default:
        return undefined;
    }
  }

  private maxSlot(a: ModelSlot, b: ModelSlot): ModelSlot {
    return (SLOT_RANK[a] ?? 0) >= (SLOT_RANK[b] ?? 0) ? a : b;
  }
```

- [ ] **Step 5: Run the full tier test file (new + existing all green)**

Run: `pnpm --filter @switchboard/core exec vitest run src/__tests__/model-router-tier.test.ts`
Expected: PASS — all 8 original cases plus the 6 new stage cases.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/model-router.ts packages/core/src/__tests__/model-router-tier.test.ts
git commit -m "feat(core): stage-aware resolveTier (rank-max, only raises)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Thread `currentStage` through `buildTierContext`

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-tier-context-builder.ts`
- Test: `packages/core/src/skill-runtime/__tests__/skill-tier-context-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/skill-runtime/__tests__/skill-tier-context-builder.test.ts`:

```ts
it("threads currentStage through to the TierContext", () => {
  const ctx = buildTierContext({
    turnCount: 3,
    declaredToolIds: [],
    tools: new Map(),
    previousTurnHadToolUse: false,
    previousTurnEscalated: false,
    currentStage: "fear",
  });
  expect(ctx.currentStage).toBe("fear");
});

it("leaves currentStage undefined when not provided", () => {
  const ctx = buildTierContext({
    turnCount: 3,
    declaredToolIds: [],
    tools: new Map(),
    previousTurnHadToolUse: false,
    previousTurnEscalated: false,
  });
  expect(ctx.currentStage).toBeUndefined();
});
```

(If the existing test file imports a `buildTierContext` already, reuse that import. Otherwise add `import { buildTierContext } from "../skill-tier-context-builder.js";` at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/__tests__/skill-tier-context-builder.test.ts`
Expected: FAIL — `currentStage` not accepted on `TierContextInput` (type error) / `ctx.currentStage` undefined assertion on the first test.

- [ ] **Step 3: Add the field to input + output**

In `packages/core/src/skill-runtime/skill-tier-context-builder.ts`:

Change the import line:

```ts
import type { TierContext, ModelSlot, DialogueStage } from "../model-router.js";
```

Add to `TierContextInput` (after `minimumModelTier`):

```ts
  minimumModelTier?: ModelSlot;
  /** Coarse dialogue stage for the current turn; raises the tier when present. */
  currentStage?: DialogueStage;
```

Add to the returned object (after `modelFloor`):

```ts
    modelFloor: input.minimumModelTier,
    currentStage: input.currentStage,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/__tests__/skill-tier-context-builder.test.ts`
Expected: PASS (existing cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/skill-tier-context-builder.ts packages/core/src/skill-runtime/__tests__/skill-tier-context-builder.test.ts
git commit -m "feat(core): thread currentStage through buildTierContext

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Call the classifier per-turn in the executor (full chain + defensive)

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts`
- Test: `packages/core/src/skill-runtime/__tests__/skill-executor-routing.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/skill-runtime/__tests__/skill-executor-routing.test.ts`. Add a helper to assert the model on the adapter call, then the cases:

```ts
async function modelForMessages(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  skill: SkillDefinition = minimalSkill,
): Promise<string | undefined> {
  const mockAdapter: ToolCallingLLMAdapter = {
    chatWithTools: vi.fn().mockResolvedValue(makeEndTurnResponse("done")),
  };
  const executor = new SkillExecutorImpl(mockAdapter, new Map(), new ModelRouter());
  await executor.execute({
    skill,
    parameters: {},
    messages,
    deploymentId: "dep-1",
    orgId: "org-1",
    trustScore: 50,
    trustLevel: "guided",
  });
  const call = (mockAdapter.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  return call?.profile?.model;
}

it("full chain: ready_now message → closing → premium (sonnet)", async () => {
  expect(await modelForMessages([{ role: "user", content: "can I book now?" }])).toBe(
    "claude-sonnet-4-6",
  );
});

it("full chain: fear message → critical (opus)", async () => {
  expect(await modelForMessages([{ role: "user", content: "I'm terrified of the pain" }])).toBe(
    "claude-opus-4-6",
  );
});

it("fear is bounded: a price-laden message stays premium, not critical", async () => {
  expect(await modelForMessages([{ role: "user", content: "scared the price is too high" }])).toBe(
    "claude-sonnet-4-6",
  );
});

it("defensive: no user message (assistant only) → no stage → default haiku", async () => {
  expect(await modelForMessages([{ role: "assistant", content: "hello there" }])).toBe(
    "claude-haiku-4-5-20251001",
  );
});

it("defensive: whitespace-only user text → no stage → default haiku", async () => {
  expect(await modelForMessages([{ role: "user", content: "   " }])).toBe(
    "claude-haiku-4-5-20251001",
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/__tests__/skill-executor-routing.test.ts`
Expected: FAIL — the ready_now/fear cases resolve to `claude-haiku-4-5-20251001` (no stage wired yet). The three existing cases still pass.

- [ ] **Step 3: Add imports + a `deriveCurrentStage` helper + thread into `buildTierContext`**

In `packages/core/src/skill-runtime/skill-executor.ts`:

Add imports near the existing model-router/tier-context imports (lines ~31-32):

```ts
import type { ModelRouter, DialogueStage } from "../model-router.js";
import { buildTierContext } from "./skill-tier-context-builder.js";
import { classifyEmotionalSignal } from "../dialogue/emotional-classifier.js";
import { emotionalSignalToStage } from "../dialogue/dialogue-stage.js";
```

(Adjust the existing `import type { ModelRouter } from "../model-router.js";` line to add `DialogueStage`; keep `buildTierContext` import as-is if already present.)

Inside `resolveProfile`, after the `if (!this.router) return undefined;` guard, derive the stage and pass it through:

```ts
if (!this.router) return undefined;

const currentStage = this.deriveCurrentStage(params.messages);

const logs: GovernanceLogEntry[] = governanceHook?.getGovernanceLogs() ?? [];
const tierCtx = buildTierContext({
  turnCount: turnCount - 1,
  declaredToolIds: params.skill.tools,
  tools: this.tools,
  previousTurnHadToolUse: turnCount > 1 && toolCallRecords.length > 0,
  previousTurnEscalated: logs.some(
    (log) => log.decision === "require-approval" || log.decision === "deny",
  ),
  minimumModelTier: params.skill.minimumModelTier,
  currentStage,
});
```

Add this private method directly below `resolveProfile`:

```ts
  /**
   * Derive the coarse dialogue stage from the latest user message using the
   * LLM-free emotional classifier (pure/sync regex). Defensive: returns
   * `undefined` when there is no user message or its text is empty, so tiering
   * silently falls back to the previous-turn rules.
   */
  private deriveCurrentStage(
    messages: SkillExecutionParams["messages"],
  ): DialogueStage | undefined {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content.trim();
    if (!text) return undefined;
    return emotionalSignalToStage(classifyEmotionalSignal({ message: text }));
  }
```

(`SkillExecutionParams` is already imported in this file via `./types.js`. If only the type is imported, this usage is fine.)

- [ ] **Step 4: Run the routing test file (new + existing all green)**

Run: `pnpm --filter @switchboard/core exec vitest run src/skill-runtime/__tests__/skill-executor-routing.test.ts`
Expected: PASS — 3 existing + 5 new.

- [ ] **Step 5: Confirm the executor stays under the 600-line cap**

Run: `wc -l packages/core/src/skill-runtime/skill-executor.ts`
Expected: < 600 (≈ 485). If approaching 600, stop and reconsider — but the change is ~10 lines so this is a safety check.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts packages/core/src/skill-runtime/__tests__/skill-executor-routing.test.ts
git commit -m "feat(core): stage-aware per-turn routing in skill executor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Barrel export + PR2 verification

**Files:**

- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Export the new mapper + type**

In `packages/core/src/index.ts`:

Add next to the existing classifier export (line ~134):

```ts
export { emotionalSignalToStage } from "./dialogue/dialogue-stage.js";
```

Add `DialogueStage` to the model-router type export (line ~213):

```ts
export type {
  ModelSlot,
  ModelConfig,
  ResolveOptions,
  TierContext,
  DialogueStage,
} from "./model-router.js";
```

- [ ] **Step 2: Full core test suite**

Run: `pnpm --filter @switchboard/core test`
Expected: PASS — all suites including the four touched files.

- [ ] **Step 3: Typecheck + build core**

Run: `pnpm --filter @switchboard/core typecheck && pnpm --filter "@switchboard/core..." build`
Expected: PASS / "Done". (Build proves `dialogue-stage.ts`'s `DialogueStage` import resolves once Task 6 landed.)

- [ ] **Step 4: Format check**

Run: `pnpm format:check`
Expected: PASS. If it fails, `pnpm format` then re-stage the affected files.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export emotionalSignalToStage + DialogueStage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# Review & Open PRs

### PR1 Review & Open (worktree `model-router-wire`)

- [ ] Run an adversarial multi-dimension review (Workflow) over the PR1 diff (`git diff origin/main...HEAD`). Fix any confirmed findings with TDD.
- [ ] Push and open PR (not merge):

```bash
git push -u origin feat/model-router-wire
gh pr create --base main --title "feat(api): activate Alex ModelRouter behind flag (default off)" --body "<see description below>"
```

PR1 description must include: the dead-router root cause, the flag (`ALEX_MODEL_ROUTER_ENABLED`, default off → prod byte-identical), what changes when flipped, and the rollout order (merge → deploy flag-off → confirm unchanged → flip after #672 baseline).

### PR2 Review & Open (worktree `model-router-stage-aware`)

- [ ] Run an adversarial multi-dimension review (Workflow) over the PR2 diff. Fix any confirmed findings with TDD.
- [ ] Push and open PR (not merge):

```bash
git push -u origin feat/model-router-stage-aware
gh pr create --base main --title "feat(core): stage-aware model tiering (objection/closing/fear)" --body "<see description below>"
```

PR2 description must state explicitly: **compiles and tests pass independently, but has zero runtime effect until PR1 is merged AND `ALEX_MODEL_ROUTER_ENABLED=true`.** Include the Balanced mapping table and the fear-bound note.

---

## Self-Review (completed by plan author)

- **Spec coverage:** PR1 factory (Task 1), wiring (Task 2), env plumbing (Task 3), verify (Task 4). PR2 mapper (Task 5), `DialogueStage`/`resolveTier` (Task 6), tier-context threading (Task 7), executor classifier + defensive extraction + full-chain/fear-bound tests (Task 8), barrel export + verify (Task 9). Rollout order in "Review & Open". All spec sections covered.
- **Placeholder scan:** none — every code/test step has concrete content.
- **Type consistency:** `DialogueStage` defined in Task 6, consumed by Task 5 (runtime via vitest before type lands — noted), Task 7, Task 8; `currentStage` field name identical across `TierContext`, `TierContextInput`, `buildTierContext`, and `resolveProfile`. `resolveModelRouter(flagValue)` signature identical in factory + test. Model IDs match `SLOT_CONFIGS` (`claude-haiku-4-5-20251001` / `claude-sonnet-4-6` / `claude-opus-4-6`).
- **Ordering note:** Task 5 (mapper) is committed before Task 6 (type) for logical grouping; the mapper's `DialogueStage` import is type-only (erased at runtime) so its vitest run passes, and core typecheck/build is deferred to Task 9 after the type exists. Acceptable for TDD red/green; flagged so the implementer isn't surprised by a transient typecheck gap mid-PR2.
