import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type { SkillDefinition, SkillExecutor } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";
import { ParameterResolutionError } from "./parameter-builder.js";

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private builderMap: Map<string, ParameterBuilder>,
    private stores: SkillStores,
    private config: SkillHandlerConfig,
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
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

    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = await this.executor.execute({
      skill: this.skill,
      parameters,
      messages,
      deploymentId: this.config.deploymentId,
      orgId: this.config.orgId,
      trustScore: ctx.trust.score,
      trustLevel: ctx.trust.level,
    });

    await ctx.chat.send(result.response);
  }
}
