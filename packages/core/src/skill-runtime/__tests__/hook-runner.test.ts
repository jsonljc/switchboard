import { describe, it, expect, vi } from "vitest";
import {
  runBeforeSkillHooks,
  runBeforeLlmCallHooks,
  runBeforeToolCallHooks,
  runAfterSkillHooks,
} from "../hook-runner.js";
import type {
  SkillHook,
  SkillHookContext,
  LlmCallContext,
  ToolCallContext,
  SkillExecutionResult,
} from "../types.js";

const baseCtx: SkillHookContext = {
  deploymentId: "d1",
  orgId: "o1",
  skillSlug: "test",
  skillVersion: "1.0.0",
  sessionId: "s1",
  trustLevel: "guided",
  trustScore: 50,
};

const llmCtx: LlmCallContext = {
  turnCount: 1,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  elapsedMs: 0,
};

const toolCtx: ToolCallContext = {
  toolId: "crm-write",
  operation: "stage.update",
  params: {},
  effectCategory: "write",
  trustLevel: "guided",
};

describe("hook-runner", () => {
  describe("runBeforeSkillHooks", () => {
    it("returns proceed=true when no hooks", async () => {
      const result = await runBeforeSkillHooks([], baseCtx);
      expect(result.proceed).toBe(true);
    });

    it("short-circuits on first proceed=false", async () => {
      const hook1: SkillHook = {
        name: "blocker",
        beforeSkill: async () => ({ proceed: false, reason: "blocked" }),
      };
      const hook2: SkillHook = {
        name: "never-reached",
        beforeSkill: vi.fn().mockResolvedValue({ proceed: true }),
      };
      const result = await runBeforeSkillHooks([hook1, hook2], baseCtx);
      expect(result.proceed).toBe(false);
      expect(result.reason).toBe("blocked");
      expect(hook2.beforeSkill).not.toHaveBeenCalled();
    });

    it("runs all hooks when all proceed", async () => {
      const hook1: SkillHook = {
        name: "a",
        beforeSkill: vi.fn().mockResolvedValue({ proceed: true }),
      };
      const hook2: SkillHook = {
        name: "b",
        beforeSkill: vi.fn().mockResolvedValue({ proceed: true }),
      };
      const result = await runBeforeSkillHooks([hook1, hook2], baseCtx);
      expect(result.proceed).toBe(true);
      expect(hook1.beforeSkill).toHaveBeenCalled();
      expect(hook2.beforeSkill).toHaveBeenCalled();
    });

    it("skips hooks without beforeSkill", async () => {
      const hook: SkillHook = { name: "no-op" };
      const result = await runBeforeSkillHooks([hook], baseCtx);
      expect(result.proceed).toBe(true);
    });
  });

  describe("runBeforeLlmCallHooks", () => {
    it("returns proceed=true and original context when no hooks", async () => {
      const result = await runBeforeLlmCallHooks([], llmCtx);
      expect(result.proceed).toBe(true);
      expect(result.ctx).toEqual(llmCtx);
    });

    it("short-circuits on proceed=false", async () => {
      const hook: SkillHook = {
        name: "budget",
        beforeLlmCall: async () => ({ proceed: false, reason: "over budget" }),
      };
      const result = await runBeforeLlmCallHooks([hook], llmCtx);
      expect(result.proceed).toBe(false);
    });

    it("threads context mutations through hooks", async () => {
      const hook: SkillHook = {
        name: "mutator",
        beforeLlmCall: async (ctx) => ({
          proceed: true,
          ctx: { ...ctx, turnCount: ctx.turnCount + 100 },
        }),
      };
      const result = await runBeforeLlmCallHooks([hook], llmCtx);
      expect(result.ctx?.turnCount).toBe(101);
    });
  });

  describe("runBeforeToolCallHooks", () => {
    it("short-circuits on proceed=false", async () => {
      const hook: SkillHook = {
        name: "gov",
        beforeToolCall: async () => ({ proceed: false, reason: "denied" }),
      };
      const result = await runBeforeToolCallHooks([hook], toolCtx);
      expect(result.proceed).toBe(false);
    });
  });

  describe("runAfterSkillHooks — registration-order invariant", () => {
    /**
     * Pins the guarantee that hook-runner iterates afterSkill hooks in
     * registration-array order AND propagates mutations between hooks.
     *
     * This is the invariant that ensures GovernanceHook (index 0) runs before
     * DeterministicSafetyGateHook (index 1) and that any response mutation by
     * the safety gate is visible to every subsequent hook (e.g. TracePersistenceHook).
     *
     * Reversal test confirms the invariant is directional: reversing the array
     * reverses the observation, proving the runner doesn't execute in parallel.
     */
    function makeResult(response: string): SkillExecutionResult {
      return {
        response,
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        trace: {
          durationMs: 0,
          turnCount: 1,
          status: "success",
          responseSummary: response,
          writeCount: 0,
          governanceDecisions: [],
        },
      };
    }

    it("gateHook → recordingHook: recording hook sees REDACTED (mutation propagates)", async () => {
      let observedResponse: string | undefined;

      const gateHook: SkillHook = {
        name: "gate",
        afterSkill: async (_ctx, result) => {
          result.response = "REDACTED";
        },
      };

      const recordingHook: SkillHook = {
        name: "recorder",
        afterSkill: async (_ctx, result) => {
          observedResponse = result.response;
        },
      };

      const result = makeResult("original response");
      await runAfterSkillHooks([gateHook, recordingHook], baseCtx, result);

      // Mutation by gateHook propagated to recordingHook
      expect(observedResponse).toBe("REDACTED");
      // Final result also reflects mutation
      expect(result.response).toBe("REDACTED");
    });

    it("recordingHook → gateHook: recording hook sees original (pre-mutation)", async () => {
      let observedResponse: string | undefined;

      const gateHook: SkillHook = {
        name: "gate",
        afterSkill: async (_ctx, result) => {
          result.response = "REDACTED";
        },
      };

      const recordingHook: SkillHook = {
        name: "recorder",
        afterSkill: async (_ctx, result) => {
          observedResponse = result.response;
        },
      };

      const result = makeResult("original response");
      // Reversed order: recorder runs before gate
      await runAfterSkillHooks([recordingHook, gateHook], baseCtx, result);

      // recordingHook ran before gateHook — saw the original
      expect(observedResponse).toBe("original response");
      // Final result still reflects the gate mutation (gate ran after)
      expect(result.response).toBe("REDACTED");
    });

    it("skips hooks without afterSkill", async () => {
      const noOp: SkillHook = { name: "no-op" };
      const result = makeResult("unchanged");
      await expect(runAfterSkillHooks([noOp], baseCtx, result)).resolves.toBeUndefined();
      expect(result.response).toBe("unchanged");
    });
  });
});
