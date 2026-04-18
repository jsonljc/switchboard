// packages/core/src/creative-pipeline/inngest-client.ts
import { Inngest } from "inngest";

/**
 * Event definitions for the creative pipeline.
 *
 * - "creative-pipeline/job.submitted": Fired when a buyer submits a brief.
 *   Triggers the creative-job-runner function.
 *
 * - "creative-pipeline/stage.approved": Fired when a buyer approves the
 *   current stage output. The running job-runner picks this up via
 *   step.waitForEvent() and proceeds to the next stage.
 */
export type CreativePipelineEvents = {
  "creative-pipeline/job.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
      mode?: string;
    };
  };
  "creative-pipeline/polished.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
      mode: "polished";
      dispatchedAt: Date;
    };
  };
  "creative-pipeline/stage.approved": {
    data: {
      jobId: string;
      action: "continue" | "stop";
    };
  };
  "creative-pipeline/ugc.submitted": {
    data: {
      jobId: string;
      taskId: string;
      organizationId: string;
      deploymentId: string;
      mode: "ugc";
      pipelineVersion: string;
      dispatchedAt: Date;
    };
  };
  "creative-pipeline/ugc-phase.completed": {
    data: {
      jobId: string;
      phase: string;
      durationMs: number;
      substagesCompleted: string[];
      resultSummary: Record<string, unknown>;
    };
  };
  "creative-pipeline/ugc-phase.approved": {
    data: {
      jobId: string;
      phase: string;
      action: "continue" | "stop";
    };
  };
  "creative-pipeline/ugc.completed": {
    data: {
      jobId: string;
      assetsProduced: number;
      failed: number;
    };
  };
  "creative-pipeline/ugc.stopped": {
    data: {
      jobId: string;
      stoppedAtPhase: string;
    };
  };
  "creative-pipeline/ugc.failed": {
    data: {
      jobId: string;
      phase: string;
      error: Record<string, unknown>;
    };
  };
};

export const inngestClient = new Inngest({
  id: "switchboard",
  schemas: new Map() as never, // Type-only — runtime validation via Zod
});
