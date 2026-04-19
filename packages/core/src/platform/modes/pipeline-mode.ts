import type { ExecutionMode, ExecutionContext } from "../execution-context.js";
import type { ExecutionConstraints } from "../governance-types.js";
import type { ExecutionResult } from "../execution-result.js";
import type { WorkUnit } from "../work-unit.js";
import type { ExecutionModeName } from "../types.js";

export interface PipelineEventSender {
  send(event: { name: string; data: Record<string, unknown> }): Promise<void>;
}

export interface PipelineModeConfig {
  eventSender: PipelineEventSender;
}

export class PipelineMode implements ExecutionMode {
  readonly name: ExecutionModeName = "pipeline";
  private readonly config: PipelineModeConfig;

  constructor(config: PipelineModeConfig) {
    this.config = config;
  }

  async execute(
    workUnit: WorkUnit,
    _constraints: ExecutionConstraints,
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const startMs = Date.now();

    try {
      const mode =
        typeof workUnit.parameters.mode === "string" ? workUnit.parameters.mode : "polished";

      await this.config.eventSender.send({
        name: "creative-pipeline/job.submitted",
        data: {
          jobId: workUnit.id,
          taskId: workUnit.id,
          organizationId: workUnit.organizationId,
          deploymentId: workUnit.organizationId,
          mode,
        },
      });

      const durationMs = Date.now() - startMs;

      return {
        workUnitId: workUnit.id,
        outcome: "queued",
        summary: `Pipeline job queued in ${mode} mode`,
        outputs: {},
        mode: "pipeline",
        durationMs,
        traceId: context.traceId,
        jobId: workUnit.id,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      return {
        workUnitId: workUnit.id,
        outcome: "failed",
        summary: "Pipeline dispatch failed",
        outputs: {},
        mode: "pipeline",
        durationMs,
        traceId: context.traceId,
        error: {
          code: "PIPELINE_DISPATCH_ERROR",
          message,
        },
      };
    }
  }
}
