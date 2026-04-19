import type {
  SkillDefinition,
  SkillExecutor,
  SkillTool,
  SkillHook,
  SkillHookContext,
} from "./types.js";
import type {
  BatchParameterBuilder,
  BatchSkillStores,
  BatchContextContract,
  BatchExecutionConfig,
  BatchSkillResult,
} from "./batch-types.js";
import { validateBatchSkillResult } from "./batch-types.js";
import { getToolGovernanceDecision } from "./governance.js";
import type { TrustLevel } from "./governance.js";
import type { ContextResolverImpl } from "./context-resolver.js";
import { ContextResolutionError } from "./types.js";
import { runBeforeSkillHooks, runAfterSkillHooks, runOnErrorHooks } from "./hook-runner.js";

interface BatchSkillHandlerConfig {
  skill: SkillDefinition;
  executor: SkillExecutor;
  builder: BatchParameterBuilder;
  stores: BatchSkillStores;
  contract: BatchContextContract;
  tools: Map<string, SkillTool>;
  trustLevel: TrustLevel;
  trustScore: number;
  hooks: SkillHook[];
  contextResolver: { resolve: ContextResolverImpl["resolve"] };
}

export interface BatchExecutionResult extends BatchSkillResult {
  executedWrites: number;
  deniedWrites: number;
  pendingApprovalWrites: number;
}

export class BatchSkillHandler {
  constructor(private config: BatchSkillHandlerConfig) {}

  async execute(execConfig: BatchExecutionConfig): Promise<BatchExecutionResult> {
    // 1. Build hook context
    const hookContext: SkillHookContext = {
      deploymentId: execConfig.deploymentId,
      orgId: execConfig.orgId,
      skillSlug: this.config.skill.slug,
      skillVersion: this.config.skill.version,
      sessionId: execConfig.trigger,
      trustLevel: this.config.trustLevel,
      trustScore: this.config.trustScore,
    };

    // 2. Run beforeSkill hooks (circuit breaker, blast radius)
    const beforeResult = await runBeforeSkillHooks(this.config.hooks, hookContext);
    if (!beforeResult.proceed) {
      throw new Error(`Batch skill blocked: ${beforeResult.reason}`);
    }

    // 3. Load context via builder
    const parameters = await this.config.builder(
      execConfig,
      this.config.stores,
      this.config.contract,
    );

    // 4. Resolve curated knowledge context
    let contextVariables: Record<string, string> = {};
    try {
      const resolved = await this.config.contextResolver.resolve(
        execConfig.orgId,
        this.config.skill.context,
      );
      contextVariables = resolved.variables;
    } catch (err) {
      if (err instanceof ContextResolutionError) {
        throw new Error(
          `Required knowledge missing for batch skill ${this.config.skill.slug}: ${err.message}`,
        );
      }
      throw err;
    }
    const mergedParameters = { ...parameters, ...contextVariables };

    // 5. Run skill via executor
    let executionResult;
    try {
      executionResult = await this.config.executor.execute({
        skill: this.config.skill,
        parameters: mergedParameters,
        messages: [{ role: "user", content: `Execute batch: ${execConfig.trigger}` }],
        deploymentId: execConfig.deploymentId,
        orgId: execConfig.orgId,
        trustScore: this.config.trustScore,
        trustLevel: this.config.trustLevel,
      });
    } catch (err) {
      await runOnErrorHooks(this.config.hooks, hookContext, err as Error);
      throw err;
    }

    // 6. Parse structured result
    let batchResult: BatchSkillResult;
    try {
      const parsed = JSON.parse(executionResult.response);
      validateBatchSkillResult(parsed);
      batchResult = parsed;
    } catch {
      batchResult = {
        recommendations: [],
        proposedWrites: [],
        summary: executionResult.response.slice(0, 500),
      };
    }

    // 7. Route proposed writes through governance — sequentially (KEEP INLINE)
    let executedWrites = 0;
    let deniedWrites = 0;
    let pendingApprovalWrites = 0;
    let writeError: string | undefined;

    for (const write of batchResult.proposedWrites) {
      const tool = this.config.tools.get(write.tool);
      const op = tool?.operations[write.operation];
      if (!op) {
        deniedWrites++;
        continue;
      }

      const decision = getToolGovernanceDecision(op, this.config.trustLevel);
      if (decision === "auto-approve") {
        try {
          await op.execute(write.params);
          executedWrites++;
        } catch (err) {
          writeError = `Write ${write.tool}.${write.operation} failed: ${(err as Error).message}`;
          console.error(writeError);
          break; // sequential — stop on failure
        }
      } else if (decision === "require-approval") {
        pendingApprovalWrites++;
        console.warn(
          `Batch write ${write.tool}.${write.operation} requires approval — queued for review`,
        );
      } else {
        deniedWrites++;
      }
    }

    // 8. Run afterSkill hooks (trace persistence, outcome linking)
    if (writeError) {
      await runOnErrorHooks(this.config.hooks, hookContext, new Error(writeError));
    } else {
      await runAfterSkillHooks(this.config.hooks, hookContext, executionResult);
    }

    return {
      ...batchResult,
      executedWrites,
      deniedWrites,
      pendingApprovalWrites,
    };
  }
}
