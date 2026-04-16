import type { AgentHandler, AgentContext } from "@switchboard/sdk";
import type {
  SkillDefinition,
  SkillExecutor,
  SkillExecutionTrace,
  SkillExecutionResult,
} from "./types.js";
import { SkillExecutionBudgetError, ContextResolutionError } from "./types.js";
import type { ParameterBuilder, SkillStores } from "./parameter-builder.js";
import { ParameterResolutionError } from "./parameter-builder.js";
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { BlastRadiusLimiter } from "./blast-radius-limiter.js";
import type { OutcomeLinker } from "./outcome-linker.js";
import type { ContextResolverImpl } from "./context-resolver.js";
import { createId } from "@paralleldrive/cuid2";
import { createHash } from "node:crypto";

interface SkillHandlerConfig {
  deploymentId: string;
  orgId: string;
  contactId: string;
  sessionId: string;
}

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

function hashParameters(params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

export class SkillHandler implements AgentHandler {
  constructor(
    private skill: SkillDefinition,
    private executor: SkillExecutor,
    private builderMap: Map<string, ParameterBuilder>,
    private stores: SkillStores,
    private config: SkillHandlerConfig,
    private traceStore: ExecutionTraceStore,
    private circuitBreaker: CircuitBreaker,
    private blastRadiusLimiter: BlastRadiusLimiter,
    private outcomeLinker: OutcomeLinker,
    private contextResolver: { resolve: ContextResolverImpl["resolve"] },
  ) {}

  async onMessage(ctx: AgentContext): Promise<void> {
    // Safety gates first
    const cbResult = await this.circuitBreaker.check(this.config.deploymentId);
    if (!cbResult.allowed) {
      await ctx.chat.send(
        "I'm having some trouble right now. Let me connect you with the team directly.",
      );
      console.error(`Circuit breaker: ${cbResult.reason}`);
      return;
    }

    const brResult = await this.blastRadiusLimiter.check(this.config.deploymentId);
    if (!brResult.allowed) {
      await ctx.chat.send(
        "I've been quite active recently. Let me connect you with the team for this one.",
      );
      console.error(`Blast radius: ${brResult.reason}`);
      return;
    }

    // Existing builder flow
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

    // Resolve curated knowledge context
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

    // Merge runtime params + knowledge context
    const mergedParameters = { ...parameters, ...contextVariables };

    const messages = (ctx.conversation?.messages ?? []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const startTime = Date.now();
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
      // Persist error trace so circuit breaker can detect failure patterns
      const status = err instanceof SkillExecutionBudgetError ? "budget_exceeded" : "error";
      const errorTrace: SkillExecutionTrace = {
        id: createId(),
        deploymentId: this.config.deploymentId,
        organizationId: this.config.orgId,
        skillSlug: this.skill.slug,
        skillVersion: this.skill.version,
        trigger: "chat_message",
        sessionId: this.config.sessionId,
        inputParametersHash: hashParameters(mergedParameters),
        toolCalls: [],
        governanceDecisions: [],
        tokenUsage: { input: 0, output: 0 },
        durationMs: Date.now() - startTime,
        turnCount: 0,
        status,
        error: err instanceof Error ? err.message : String(err),
        responseSummary: "",
        writeCount: 0,
        createdAt: new Date(),
      };
      try {
        await this.traceStore.create(errorTrace);
      } catch (traceErr) {
        console.error(`Error trace persistence failed for ${errorTrace.id}:`, traceErr);
      }
      await ctx.chat.send(
        "I ran into an issue processing your request. Let me connect you with the team.",
      );
      return;
    }

    // Assemble success trace — handler owns the ID
    const trace: SkillExecutionTrace = {
      id: createId(),
      deploymentId: this.config.deploymentId,
      organizationId: this.config.orgId,
      skillSlug: this.skill.slug,
      skillVersion: this.skill.version,
      trigger: "chat_message",
      sessionId: this.config.sessionId,
      inputParametersHash: hashParameters(mergedParameters),
      toolCalls: result.toolCalls,
      governanceDecisions: result.trace.governanceDecisions,
      tokenUsage: result.tokenUsage,
      durationMs: result.trace.durationMs,
      turnCount: result.trace.turnCount,
      status: result.trace.status,
      error: result.trace.error,
      responseSummary: result.response.slice(0, 500),
      writeCount: result.trace.writeCount,
      createdAt: new Date(),
    };

    // Persist + link outcome (try/catch — tracing must not block user)
    try {
      await this.traceStore.create(trace);
      await this.outcomeLinker.linkFromToolCalls(trace.id, result.toolCalls);
    } catch (err) {
      console.error(`Trace persistence failed for ${trace.id}:`, err);
    }

    await ctx.chat.send(result.response);
  }
}
