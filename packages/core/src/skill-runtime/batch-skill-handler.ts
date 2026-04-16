import type { SkillDefinition, SkillExecutor, SkillExecutionTrace, SkillTool } from "./types.js";
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
import type { CircuitBreaker } from "./circuit-breaker.js";
import type { BlastRadiusLimiter } from "./blast-radius-limiter.js";
import type { OutcomeLinker } from "./outcome-linker.js";
import type { ContextResolverImpl } from "./context-resolver.js";
import { ContextResolutionError } from "./types.js";
import { createId } from "@paralleldrive/cuid2";
import { createHash } from "node:crypto";

interface ExecutionTraceStore {
  create(trace: SkillExecutionTrace): Promise<void>;
}

interface BatchSkillHandlerConfig {
  skill: SkillDefinition;
  executor: SkillExecutor;
  builder: BatchParameterBuilder;
  stores: BatchSkillStores;
  contract: BatchContextContract;
  tools: Map<string, SkillTool>;
  trustLevel: TrustLevel;
  trustScore: number;
  traceStore: ExecutionTraceStore;
  circuitBreaker: CircuitBreaker;
  blastRadiusLimiter: BlastRadiusLimiter;
  outcomeLinker: OutcomeLinker;
  contextResolver: { resolve: ContextResolverImpl["resolve"] };
}

export interface BatchExecutionResult extends BatchSkillResult {
  executedWrites: number;
  deniedWrites: number;
  pendingApprovalWrites: number;
  traceId: string;
}

function hashParameters(params: Record<string, unknown>): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(sorted).digest("hex");
}

export class BatchSkillHandler {
  constructor(private config: BatchSkillHandlerConfig) {}

  async execute(execConfig: BatchExecutionConfig): Promise<BatchExecutionResult> {
    // 1. Safety gates
    const cbResult = await this.config.circuitBreaker.check(execConfig.deploymentId);
    if (!cbResult.allowed) {
      throw new Error(`Circuit breaker tripped for ${execConfig.deploymentId}: ${cbResult.reason}`);
    }

    const brResult = await this.config.blastRadiusLimiter.check(execConfig.deploymentId);
    if (!brResult.allowed) {
      throw new Error(`Blast radius limit for ${execConfig.deploymentId}: ${brResult.reason}`);
    }

    // 2. Load context via builder
    const parameters = await this.config.builder(
      execConfig,
      this.config.stores,
      this.config.contract,
    );

    // Resolve curated knowledge context
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

    // 3. Run skill via executor
    const executionResult = await this.config.executor.execute({
      skill: this.config.skill,
      parameters: mergedParameters,
      messages: [{ role: "user", content: `Execute batch: ${execConfig.trigger}` }],
      deploymentId: execConfig.deploymentId,
      orgId: execConfig.orgId,
      trustScore: this.config.trustScore,
      trustLevel: this.config.trustLevel,
    });

    // 4. Parse structured result
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

    // 5. Route proposed writes through governance — sequentially
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

    // 6. Assemble + persist trace
    const traceId = createId();
    const trace: SkillExecutionTrace = {
      id: traceId,
      deploymentId: execConfig.deploymentId,
      organizationId: execConfig.orgId,
      skillSlug: this.config.skill.slug,
      skillVersion: this.config.skill.version,
      trigger: "batch_job",
      sessionId: execConfig.trigger,
      inputParametersHash: hashParameters(mergedParameters),
      toolCalls: executionResult.toolCalls,
      governanceDecisions: executionResult.trace.governanceDecisions,
      tokenUsage: executionResult.tokenUsage,
      durationMs: executionResult.trace.durationMs,
      turnCount: executionResult.trace.turnCount,
      status: writeError ? "error" : executionResult.trace.status,
      error: writeError ?? executionResult.trace.error,
      responseSummary: batchResult.summary.slice(0, 500),
      writeCount: executedWrites,
      createdAt: new Date(),
    };

    try {
      await this.config.traceStore.create(trace);
      await this.config.outcomeLinker.linkFromToolCalls(traceId, executionResult.toolCalls);
    } catch (err) {
      console.error(`Batch trace persistence failed for ${traceId}:`, err);
    }

    return {
      ...batchResult,
      executedWrites,
      deniedWrites,
      pendingApprovalWrites,
      traceId,
    };
  }
}
