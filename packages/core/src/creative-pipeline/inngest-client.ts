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
    };
  };
  "creative-pipeline/stage.approved": {
    data: {
      jobId: string;
      action: "continue" | "stop";
    };
  };
};

export const inngestClient = new Inngest({
  id: "switchboard",
  schemas: new Map() as never, // Type-only — runtime validation via Zod
});
