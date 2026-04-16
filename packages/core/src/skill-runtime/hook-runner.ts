import type {
  SkillHook,
  SkillHookContext,
  LlmCallContext,
  LlmResponse,
  ToolCallContext,
  HookResult,
  LlmHookResult,
  SkillExecutionResult,
} from "./types.js";

export async function runBeforeSkillHooks(
  hooks: SkillHook[],
  ctx: SkillHookContext,
): Promise<HookResult> {
  for (const hook of hooks) {
    if (hook.beforeSkill) {
      const result = await hook.beforeSkill(ctx);
      if (!result.proceed) return result;
    }
  }
  return { proceed: true };
}

export async function runBeforeLlmCallHooks(
  hooks: SkillHook[],
  ctx: LlmCallContext,
): Promise<LlmHookResult> {
  let current = ctx;
  for (const hook of hooks) {
    if (hook.beforeLlmCall) {
      const result = await hook.beforeLlmCall(current);
      if (!result.proceed) return result;
      if (result.ctx) current = result.ctx;
    }
  }
  return { proceed: true, ctx: current };
}

export async function runAfterLlmCallHooks(
  hooks: SkillHook[],
  ctx: LlmCallContext,
  response: LlmResponse,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterLlmCall) {
      await hook.afterLlmCall(ctx, response);
    }
  }
}

export async function runBeforeToolCallHooks(
  hooks: SkillHook[],
  ctx: ToolCallContext,
): Promise<HookResult> {
  for (const hook of hooks) {
    if (hook.beforeToolCall) {
      const result = await hook.beforeToolCall(ctx);
      if (!result.proceed) return result;
    }
  }
  return { proceed: true };
}

export async function runAfterToolCallHooks(
  hooks: SkillHook[],
  ctx: ToolCallContext,
  result: unknown,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterToolCall) {
      await hook.afterToolCall(ctx, result);
    }
  }
}

export async function runAfterSkillHooks(
  hooks: SkillHook[],
  ctx: SkillHookContext,
  result: SkillExecutionResult,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.afterSkill) {
      try {
        await hook.afterSkill(ctx, result);
      } catch (err) {
        console.error(`Hook ${hook.name} afterSkill failed:`, err);
      }
    }
  }
}

export async function runOnErrorHooks(
  hooks: SkillHook[],
  ctx: SkillHookContext,
  error: Error,
): Promise<void> {
  for (const hook of hooks) {
    if (hook.onError) {
      try {
        await hook.onError(ctx, error);
      } catch (hookErr) {
        console.error(`Hook ${hook.name} onError failed:`, hookErr);
      }
    }
  }
}
