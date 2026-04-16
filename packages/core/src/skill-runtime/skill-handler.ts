import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type {
  SkillDefinition,
  SkillExecutor,
  SkillExecutionResult,
  SkillHook,
  SkillHookContext,
} from "./types.js";
import { ContextResolutionError } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";
import { ParameterResolutionError } from "./parameter-builder.js";
import type { ContextResolverImpl } from "./context-resolver.js";
import { runBeforeSkillHooks, runAfterSkillHooks, runOnErrorHooks } from "./hook-runner.js";

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
  contactId: string;
  sessionId: string;
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private builderMap: Map<string, ParameterBuilder>,
    private stores: SkillStores,
    private config: SkillHandlerConfig,
    private hooks: SkillHook[],
    private contextResolver: { resolve: ContextResolverImpl["resolve"] },
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    // 1. Build hook context
    const hookContext: SkillHookContext = {
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      skillSlug: this.skill.slug,
      skillVersion: this.skill.version,
      sessionId: this.config.sessionId,
      trustLevel: ctx.trust.level,
      trustScore: ctx.trust.score,
    };

    // 2. Run beforeSkill hooks (circuit breaker, blast radius)
    const beforeResult = await runBeforeSkillHooks(this.hooks, hookContext);
    if (!beforeResult.proceed) {
      await ctx.chat.send(
        "I'm having some trouble right now. Let me connect you with the team directly.",
      );
      console.error(`Skill blocked: ${beforeResult.reason}`);
      return;
    }

    // 3. Parameter building
    const builder = this.builderMap.get(this.skill.slug);
    if (!builder) {
      throw new Error(`No parameter builder registered for skill: ${this.skill.slug}`);
    }

    let parameters: Record<string, unknown>;
    try {
      parameters = await builder(ctx, this.config, this.stores);
    } catch (err) {
      if (err instanceof ParameterResolutionError) {
        await ctx.chat.send(err.userMessage);
        return;
      }
      throw err;
    }

    // 4. Resolve curated knowledge context
    let contextVariables: Record<string, string> = {};
    try {
      const resolved = await this.contextResolver.resolve(this.config.orgId, this.skill.context);
      contextVariables = resolved.variables;
    } catch (err) {
      if (err instanceof ContextResolutionError) {
        await ctx.chat.send(
          "I'm missing some required setup. Please contact your admin to configure knowledge entries.",
        );
        console.error(`Context resolution failed: ${err.message}`);
        return;
      }
      throw err;
    }

    // 5. Merge runtime params + knowledge context
    const mergedParameters = { ...parameters, ...contextVariables };

    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // 6. Execute skill
    let result: SkillExecutionResult;
    try {
      result = await this.executor.execute({
        skill: this.skill,
        parameters: mergedParameters,
        messages,
        deploymentId: this.config.deploymentId,
        orgId: this.config.orgId,
        trustScore: ctx.trust.score,
        trustLevel: ctx.trust.level,
      });
    } catch (err) {
      // 7. On error: run error hooks (trace persistence)
      await runOnErrorHooks(this.hooks, hookContext, err as Error);
      await ctx.chat.send(
        "I ran into an issue processing your request. Let me connect you with the team.",
      );
      return;
    }

    // 8. On success: run afterSkill hooks (trace persistence, outcome linking)
    // Trace/linking failures must not block the user from getting their response.
    try {
      await runAfterSkillHooks(this.hooks, hookContext, result);
    } catch (err) {
      console.error(`afterSkill hooks failed for ${this.skill.slug}:`, err);
    }

    // 9. Send response
    await ctx.chat.send(result.response);
  }
}
