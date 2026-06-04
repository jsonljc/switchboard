# Alex Governance `afterSkill` Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dormant governance `afterSkill` gates into the live `SkillExecutorImpl.execute()` byte-identically (fixing the WhatsApp gate's blank-on-missing landmine first), and make the alex-conversation eval governance-aware so a gate regression reds it — without seeding any config (prod behaviour unchanged at merge).

**Architecture:** Three focused changes in one branch. (1) `whatsapp-window-gate.ts`: split the resolver result into off/config/unavailable so a `missing` governanceConfig is a clean no-op instead of an unconditional reply-blank. (2) `skill-executor.ts`: call `runAfterSkillHooks(this.hooks, hookCtx, result)` after result assembly and before the fire-and-forget trace recorder, wrapped in a fail-open try/catch. (3) `evals/alex-conversation`: thread an optional governed-hooks array through the harness (default `[]`) and add a deterministic governed live-path bite test that proves a real gate fires through the real executor and goes red when the seam is wired out.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Vitest, pnpm + Turborepo. Surface-agnostic backend (`packages/core` must not reference UI). Spec: `docs/superpowers/specs/2026-06-04-alex-governance-gate-seam-design.md`.

**Pre-flight (already done by the executing session):** worktree initialized (`pnpm install && pnpm build` green). Branch `feat/alex-governance-gate-seam` off `main` @ `40db8929`.

---

## Task 1: WhatsApp gate missing-safe fix (the merge-blocker)

Today `WhatsAppWindowGateHook.resolveConfig` returns `null` for **any** non-`resolved` resolver status — including `status:"missing"` (no governanceConfig) — and `afterSkill` blanks `result.response = ""` on `null`, on every channel. Wiring the seam (Task 2) would therefore erase every Alex reply in prod. Fix: carve out `missing` (and resolved-without-`whatsappWindow`-block) as a clean no-op; preserve the deliberate fail-closed blank only for a genuine resolver error/throw with no cached posture.

**Files:**

- Modify: `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts` (the `afterSkill` head `:59-80` and `resolveConfig` `:263-284`; add a small union type)
- Test: `packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts` (add a new describe block; existing tests must stay green)

- [ ] **Step 1: Write the failing tests** — append to `whatsapp-window-gate.test.ts` (it already defines `makeDeps`, `makeCtx`, `makeResult`):

```ts
describe("WhatsAppWindowGateHook — unconfigured deployment (no-op, byte-identical)", () => {
  it("status:'missing' → passthrough: response unchanged, no verdict, channel resolver never called", async () => {
    const deps = makeDeps({
      governanceConfigResolver: vi.fn().mockResolvedValue({ status: "missing" }),
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    const before = result.response;

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe(before);
    expect(deps.verdictStore.save).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
    expect(deps.channelTypeResolver.resolve).not.toHaveBeenCalled();
  });

  it("resolved governanceConfig WITHOUT a whatsappWindow block → passthrough, no verdict", async () => {
    const deps = makeDeps({
      governanceConfigResolver: vi.fn().mockResolvedValue({
        status: "resolved",
        config: { jurisdiction: "SG", clinicType: "medical" }, // no whatsappWindow sub-block
      }),
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    const before = result.response;

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe(before);
    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- whatsapp-window-gate`
Expected: the two new tests FAIL — current code blanks `result.response` to `""` and calls `verdictStore.save` with `governance_unavailable` on `missing`. The existing "fail closed" tests still PASS.

- [ ] **Step 3: Add the resolution union type** — in `whatsapp-window-gate.ts`, after the `BlockSubCause` type (around `:47-52`) and before `export class WhatsAppWindowGateHook`:

```ts
/**
 * Three-state result of resolving WhatsApp-window governance for a deployment.
 *  - "off":          no governanceConfig, or a config without a `whatsappWindow`
 *                    block → WhatsApp gating is not configured → clean no-op.
 *  - "config":       a usable posture (resolved, or recovered from the cache on error).
 *  - "unavailable":  a genuine resolver error/throw with NO cached posture → no mode
 *                    signal → fail-closed (matches the gate's deliberate 1c precedent).
 */
type WhatsAppConfigResolution =
  | { kind: "off" }
  | { kind: "config"; config: WhatsAppWindowGateConfig }
  | { kind: "unavailable" };
```

- [ ] **Step 4: Replace the `afterSkill` resolver head** — swap the current `:65-80` block:

```ts
const config = await this.resolveConfig(ctx.deploymentId);
if (!config) {
  // Fail-closed: governance is unavailable. Match 1c's precedent — block hard.
  await this.emitVerdict({
    ctx,
    action: "block",
    reasonCode: "governance_unavailable",
    jurisdiction: "SG",
    clinicType: "medical",
    auditLevel: "critical",
    details: { reason: "resolver_error" },
  });
  result.response = "";
  return;
}
if (!config.enabled) return;
```

with:

```ts
const resolution = await this.resolveConfig(ctx.deploymentId);
if (resolution.kind === "off") {
  // No WhatsApp governance configured for this deployment (governanceConfig missing,
  // or present without a `whatsappWindow` block). Clean no-op — mirrors the three
  // sibling afterSkill gates which early-return on resolver status:"missing". THIS is
  // what makes wiring runAfterSkillHooks byte-identical for an unseeded deployment.
  return;
}
if (resolution.kind === "unavailable") {
  // Genuine resolver error/throw with no cached posture → no mode signal. Preserve the
  // deliberate hard-block posture (1c precedent) for an actually-erroring resolver.
  await this.emitVerdict({
    ctx,
    action: "block",
    reasonCode: "governance_unavailable",
    jurisdiction: "SG",
    clinicType: "medical",
    auditLevel: "critical",
    details: { reason: "resolver_error" },
  });
  result.response = "";
  return;
}
const config = resolution.config;
if (!config.enabled) return;
```

- [ ] **Step 5: Replace `resolveConfig`** — swap the current `:263-284` method with:

```ts
  private async resolveConfig(deploymentId: string): Promise<WhatsAppConfigResolution> {
    try {
      const resolution = await this.deps.governanceConfigResolver(deploymentId);
      if (resolution.status === "missing") {
        // No governanceConfig at all → WhatsApp gating is off. Clean no-op.
        return { kind: "off" };
      }
      if (resolution.status === "error") {
        // Config present but invalid (or store error). Fail-closed only via a cached
        // posture; otherwise unavailable.
        const cached = this.deps.postureCache.lastKnown(deploymentId);
        return cached ? { kind: "config", config: cached } : { kind: "unavailable" };
      }
      const raw = resolution.config as {
        whatsappWindow?: Omit<WhatsAppWindowGateConfig, "clinicType" | "jurisdiction">;
        jurisdiction: Jurisdiction;
        clinicType: "medical" | "nonMedical";
      };
      if (!raw.whatsappWindow) {
        // A governanceConfig exists but opts out of WhatsApp-window gating → no-op.
        return { kind: "off" };
      }
      const posture: WhatsAppWindowGateConfig = {
        ...raw.whatsappWindow,
        jurisdiction: raw.jurisdiction,
        clinicType: raw.clinicType,
      };
      this.deps.postureCache.remember(deploymentId, posture);
      return { kind: "config", config: posture };
    } catch {
      const cached = this.deps.postureCache.lastKnown(deploymentId);
      return cached ? { kind: "config", config: cached } : { kind: "unavailable" };
    }
  }
```

- [ ] **Step 6: Run the gate tests to verify all pass**

Run: `pnpm --filter @switchboard/core test -- whatsapp-window-gate`
Expected: PASS — the two new no-op tests pass; all existing "inside/outside window", "mode and flag", and "fail closed" tests stay green (they use resolver `mockRejectedValue` / cached posture, not `status:"missing"`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/hooks/whatsapp-window-gate.ts \
        packages/core/src/skill-runtime/hooks/whatsapp-window-gate.test.ts
git commit -m "fix(core): whatsapp gate treats missing governanceConfig as a no-op, not a reply-blank"
```

---

## Task 2: Wire the `afterSkill` seam into `execute()`

`SkillExecutorImpl.execute()` never calls `runAfterSkillHooks`, so the four gates are dead on the live path. Call it after the `result` is assembled and **before** the fire-and-forget trace recorder (so a gate's in-place `result.response` mutation is reflected in both the returned reply and the persisted trace), wrapped in a fail-open try/catch.

**Files:**

- Modify: `packages/core/src/skill-runtime/skill-executor.ts` (import block `:47-52`; success-return block, insert between `:462` and `:464`)
- Test: `packages/core/src/skill-runtime/skill-executor.test.ts` (add a describe block; reuses `createMockAdapter` + `mockSkill`)

- [ ] **Step 1: Write the failing tests** — append to `skill-executor.test.ts`:

```ts
describe("SkillExecutorImpl — afterSkill governance seam", () => {
  const execParams = {
    skill: mockSkill,
    parameters: { NAME: "Alice" },
    messages: [{ role: "user" as const, content: "hello" }],
    deploymentId: "d1",
    orgId: "org1",
    trustScore: 50,
    trustLevel: "guided" as const,
  };

  it("invokes runAfterSkillHooks: a hook's afterSkill runs and can mutate result.response", async () => {
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: "raw reply" }], stop_reason: "end_turn" },
    ]);
    let seen: SkillExecutionResult | undefined;
    const recordingHook = {
      name: "recording",
      afterSkill: async (_ctx: SkillHookContext, result: SkillExecutionResult) => {
        seen = result;
        result.response = "MUTATED";
      },
    };
    const executor = new SkillExecutorImpl(adapter, new Map(), undefined, [recordingHook]);

    const result = await executor.execute(execParams);

    expect(seen).toBeDefined();
    expect(seen!.response).toBe("raw reply"); // hook saw the assembled reply...
    expect(result.response).toBe("MUTATED"); // ...and its mutation IS the returned reply
  });

  it("with no hooks ([]) the response is unchanged (control)", async () => {
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: "raw reply" }], stop_reason: "end_turn" },
    ]);
    const executor = new SkillExecutorImpl(adapter, new Map(), undefined, []);

    const result = await executor.execute(execParams);

    expect(result.response).toBe("raw reply");
  });

  it("fail-open: an afterSkill hook that throws does not crash the turn or blank the reply", async () => {
    const adapter = createMockAdapter([
      { content: [{ type: "text", text: "raw reply" }], stop_reason: "end_turn" },
    ]);
    const throwingHook = {
      name: "throwing",
      afterSkill: async () => {
        throw new Error("gate bug");
      },
    };
    const executor = new SkillExecutorImpl(adapter, new Map(), undefined, [throwingHook]);

    const result = await executor.execute(execParams);

    expect(result.response).toBe("raw reply"); // swallowed, fail-open
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- skill-executor.test`
Expected: the first test FAILS (`seen` is `undefined`, `result.response` is `"raw reply"` not `"MUTATED"` — `runAfterSkillHooks` is never called). The control + fail-open tests pass trivially (no seam yet).

- [ ] **Step 3: Add the import** — extend the hook-runner import at `skill-executor.ts:47-52`:

```ts
import {
  runBeforeLlmCallHooks,
  runAfterLlmCallHooks,
  runBeforeToolCallHooks,
  runAfterToolCallHooks,
  runAfterSkillHooks,
} from "./hook-runner.js";
```

- [ ] **Step 4: Insert the seam** — in the success-return block, after the `result` object literal closes (`skill-executor.ts:462`) and **before** the `// Isolated telemetry recorder` comment (`:464`):

```ts
// Governance afterSkill gates (banned-phrase / claim / PDPA / WhatsApp-window).
// Wired here — AFTER result assembly, BEFORE the isolated trace recorder — so any
// in-place result.response mutation (enforce-mode block/rewrite/handoff) is reflected
// in BOTH the returned reply and the persisted ExecutionTrace (the trace recorder reads
// `result` by reference), preserving the "trace never sees pre-block unsafe text"
// invariant the bootstrap relies on. Fail-OPEN on an unexpected gate throw: a governance
// logic bug must never crash a lead turn. Each gate already fails CLOSED internally
// (posture cache) for the resolver-unavailable case; this guard is for logic bugs only.
// With no governanceConfig seeded today, every gate early-returns → inert in prod.
try {
  await runAfterSkillHooks(this.hooks, hookCtx, result);
} catch (e: unknown) {
  console.warn(
    "[SkillExecutor] afterSkill governance hook threw (swallowed, fail-open):",
    e instanceof Error ? e.message : String(e),
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- skill-executor.test`
Expected: PASS — all three seam tests green; the existing `SkillExecutorImpl` suite stays green (governance/budget/trace tests unaffected; with `[]` or no hooks the seam is a no-op loop).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/skill-executor.ts \
        packages/core/src/skill-runtime/skill-executor.test.ts
git commit -m "feat(core): run afterSkill governance hooks in the live skill executor"
```

---

## Task 3: Make the alex-conversation eval governance-aware (the keystone)

Thread an optional governed-hooks array through the harness (default `[]` → baseline byte-identical) and add a deterministic governed live-path bite test that drives the **real** executor with the **real** `DeterministicSafetyGateHook` and proves it fires — and goes red when the seam is wired out. The oracle keys on tool calls and gates mutate `result.response`, so this dedicated `__tests__` test (not the baseline scenarios) is the regression net; it runs in the BLOCKING eval vitest step.

**Files:**

- Modify: `evals/alex-conversation/run-conversation.ts` (`RunConversationDeps` + `buildExecutor`)
- Create: `evals/alex-conversation/__tests__/governed-live-path.test.ts`

- [ ] **Step 1: Thread the hooks capability into the harness** — in `run-conversation.ts`:

(a) extend the type import at `:8-13` to add `SkillHook`:

```ts
import type {
  SkillDefinition,
  SkillExecutionParams,
  SkillExecutionResult,
  SkillHook,
  SkillTool,
} from "@switchboard/core/skill-runtime";
```

(b) add a field to `RunConversationDeps` (after `maxTokens`, `:58`):

```ts
  /**
   * Optional governance hooks for the real-adapter path. Default [] keeps the
   * eval ungoverned (baseline byte-identical). Supplying the live afterSkill gates
   * makes a governed run possible so a gate regression is observable. Ignored when
   * an `executor` is injected directly (that seam owns its own hooks).
   */
  hooks?: SkillHook[];
```

(c) update `buildExecutor` (`:261-275`) — replace the `[]` and its comment:

```ts
// No router (undefined). Hooks default to [] (deterministic, ungoverned offline run);
// callers may supply the live afterSkill gates via deps.hooks to drive a governed run.
// The temp-0 adapter forces temperature:0 despite the absent router.
return new SkillExecutorImpl(adapter, tools, undefined, deps.hooks ?? []);
```

- [ ] **Step 2: Verify the harness change typechecks and existing eval tests stay green**

Run: `pnpm --filter @switchboard/eval-alex-conversation typecheck && pnpm exec vitest run --config evals/vitest.config.ts alex-conversation/__tests__/run-conversation`
Expected: PASS — `deps.hooks ?? []` is a pure pass-through; the existing `run-conversation.test.ts` (which never sets `hooks`) is unchanged. No baselined number moves (default `[]`).

- [ ] **Step 3: Write the failing bite test** — create `evals/alex-conversation/__tests__/governed-live-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SkillExecutorImpl,
  DeterministicSafetyGateHook,
  InMemoryGovernancePostureCache,
} from "@switchboard/core/skill-runtime";
import type { SkillDefinition, SkillExecutionResult } from "@switchboard/core/skill-runtime";

// Governance gates act by mutating result.response (block/rewrite/handoff), NOT by calling a
// tool — so the alex-conversation oracle (which keys on tool calls) cannot see them. This
// deterministic live-path test drives the REAL executor with the REAL DeterministicSafetyGateHook
// and asserts the gate fires THROUGH the executor's runAfterSkillHooks seam, and (the bite) that
// it does NOT fire when the gate is wired out. This is what reds the eval on a seam regression.

const BANNED_PHRASE = "guaranteed results";

const skill: SkillDefinition = {
  name: "alex-test",
  slug: "alex-test",
  version: "1.0.0",
  description: "test",
  author: "test",
  parameters: [],
  tools: [],
  body: "You are Alex.",
  context: [],
};

// Stub adapter: one text reply containing the banned phrase, then end the turn.
function bannedReplyAdapter() {
  return {
    chatWithTools: async () => ({
      content: [{ type: "text" as const, text: `We deliver ${BANNED_PHRASE} for every client.` }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 8 },
    }),
  };
}

// Real DeterministicSafetyGateHook in ENFORCE mode with a single banned phrase. Stores are
// no-op fakes (we assert on result.response, not persistence). `as never` mirrors the deps
// convention in whatsapp-window-gate.test.ts (the store interfaces are not exported).
function enforceSafetyGate() {
  const deps = {
    governanceConfigResolver: async () => ({
      status: "resolved",
      config: {
        jurisdiction: "SG",
        clinicType: "nonMedical",
        deterministicGate: { mode: "enforce" },
      },
    }),
    bannedPhraseLoader: () => [
      {
        id: "test-guarantee",
        category: "guarantee" as const,
        patterns: [BANNED_PHRASE],
        severity: "block" as const,
      },
    ],
    verdictStore: { save: async () => {} },
    handoffStore: { save: async () => {} },
    conversationStore: { setConversationStatus: async () => {} },
    postureCache: new InMemoryGovernancePostureCache(),
    clock: () => new Date("2026-06-04T00:00:00.000Z"),
  };
  return new DeterministicSafetyGateHook(deps as never);
}

const execParams = {
  skill,
  parameters: {},
  messages: [{ role: "user" as const, content: "Do your treatments work?" }],
  deploymentId: "eval-deployment",
  orgId: "eval-org",
  trustScore: 100,
  trustLevel: "autonomous" as const,
  sessionId: "eval-governed",
};

describe("governed live-path: afterSkill safety gate fires through the executor", () => {
  it("FIRES: with the gate wired, the banned phrase is replaced (handoff)", async () => {
    const executor = new SkillExecutorImpl(bannedReplyAdapter(), new Map(), undefined, [
      enforceSafetyGate(),
    ]);
    const result: SkillExecutionResult = await executor.execute(execParams);
    expect(result.response).not.toContain(BANNED_PHRASE);
  });

  it("BITES: with the gate wired out ([] hooks), the banned phrase survives", async () => {
    const executor = new SkillExecutorImpl(bannedReplyAdapter(), new Map(), undefined, []);
    const result: SkillExecutionResult = await executor.execute(execParams);
    expect(result.response).toContain(BANNED_PHRASE);
  });
});
```

- [ ] **Step 4: Run the bite test to verify it passes (and proves the bite)**

Run: `pnpm exec vitest run --config evals/vitest.config.ts alex-conversation/__tests__/governed-live-path`
Expected: PASS — the FIRES case shows the gate replaced the banned phrase through the real executor seam; the BITES case (control) shows the phrase survives without the gate. (If FIRES fails because the scanner did not match, confirm `scanForBannedPhrases` matching semantics and adjust the pattern to a guaranteed substring match — the gate code is in `packages/core/src/governance/scanner/banned-phrase-scanner.ts`.)

- [ ] **Step 5: Prove the seam-removal redness manually (adversarial self-check)**

Temporarily comment out the `runAfterSkillHooks` call added in Task 2, then:
Run: `pnpm exec vitest run --config evals/vitest.config.ts alex-conversation/__tests__/governed-live-path`
Expected: the FIRES test goes RED (the banned phrase is no longer replaced). Restore the seam and re-run → green. This demonstrates the "green eval blind to live seams" gap is closed. Do NOT commit the temporary removal.

- [ ] **Step 6: Commit**

```bash
git add evals/alex-conversation/run-conversation.ts \
        evals/alex-conversation/__tests__/governed-live-path.test.ts
git commit -m "test(eval): governance-aware alex live-path bite test + governed-hooks harness seam"
```

---

## Task 4: Full local gate + adversarial pass

- [ ] **Step 1: Build, typecheck, test, format, lint**

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm format:check && pnpm lint
```

Expected: green. Known pre-existing noise (NOT regressions from this branch): `apps/chat` `gateway-bridge-attribution` may flake under full-suite load; `packages/db` `pg_advisory` / ledger / greeting tests fail locally without Postgres (CI mocks Prisma). `pnpm lint` covers the 600-line arch-check (`skill-executor.ts` already carries `/* eslint-disable max-lines */`).

- [ ] **Step 2: Eval typechecks (CI runs these via `turbo typecheck`)**

```bash
pnpm --filter @switchboard/eval-alex-conversation typecheck
pnpm exec vitest run --config evals/vitest.config.ts alex-conversation/__tests__
```

Expected: green — the bite test imports only `@switchboard/core/skill-runtime` (built in all four eval CI jobs), so no `ci.yml` change is needed. Confirm `evals/alex-conversation/baseline.json` is untouched (no `--write-baseline` run) and the claim-classifier baseline/prompt-hash files are not modified by this branch (`git status` clean of `evals/**/baseline.json`).

- [ ] **Step 3: Independent adversarial pass (codex)**

Invoke `/codex:rescue` on the branch diff to red-team: (a) the seam ordering vs the trace recorder (no pre-block-text regression), (b) the WhatsApp fix has no remaining `missing`/no-block reply-blank, (c) the bite test genuinely reds when the seam is removed, (d) byte-identical-at-merge holds for all four gates with no config seeded.

- [ ] **Step 4: Whole-branch code review (correctness + architecture)**

Use superpowers:requesting-code-review for a whole-branch review (both correctness and architecture-alignment) before finishing the branch.

---

## Self-review notes

- **Spec coverage:** §2 seam → Task 2; §3 WhatsApp fix → Task 1; §4 eval-awareness (4a harness + 4b bite) → Task 3; §5 executor unit test → Task 2 (recording-hook test); §6 testing invariant → Tasks 1-3 + Task 4; §7 PR2 → documented in the spec/PR, not built here.
- **No seed, no migration, no metrics, no dashboard** — matches §0 non-goals.
- **Type consistency:** `WhatsAppConfigResolution` kinds (`off`/`config`/`unavailable`) used identically in `resolveConfig` (Task 1 Step 5) and `afterSkill` (Task 1 Step 4). `runAfterSkillHooks(hooks, ctx, result)` signature matches `hook-runner.ts:77-87`. `deps.hooks ?? []` matches the new `RunConversationDeps.hooks?: SkillHook[]`.
- **Byte-identical guarantee:** with no governanceConfig seeded, all four gates early-return on `missing` (Task 1 makes WhatsApp join the other three) → the Task 2 seam is a no-op loop in prod.
