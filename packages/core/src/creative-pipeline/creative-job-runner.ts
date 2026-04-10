// packages/core/src/creative-pipeline/creative-job-runner.ts
import { inngestClient } from "./inngest-client.js";
import { runStage, getNextStage } from "./stages/run-stage.js";
import type { StageName } from "./stages/run-stage.js";
import type { CreativeJob } from "@switchboard/schemas";

const STAGES: StageName[] = ["trends", "hooks", "scripts", "storyboard", "production"];

// 24-hour timeout for buyer approval between stages
const APPROVAL_TIMEOUT = "24h";

interface LLMConfig {
  apiKey: string;
}

interface JobStore {
  findById(id: string): Promise<CreativeJob | null>;
  updateStage(
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob>;
  stop(id: string, stoppedAt: string): Promise<CreativeJob>;
}

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match: string },
  ) => Promise<{ data: { action: string } } | null>;
}

interface JobEventData {
  jobId: string;
  taskId: string;
  organizationId: string;
  deploymentId: string;
}

/**
 * Core pipeline logic extracted for testability.
 * Called by the Inngest function handler with real step tools,
 * or by tests with mocked step tools.
 */
export async function executeCreativePipeline(
  eventData: JobEventData,
  step: StepTools,
  jobStore: JobStore,
  llmConfig: LLMConfig,
): Promise<void> {
  const job = await step.run("load-job", () => jobStore.findById(eventData.jobId));

  if (!job) {
    throw new Error(`Creative job not found: ${eventData.jobId}`);
  }

  let stageOutputs: Record<string, unknown> = (job.stageOutputs ?? {}) as Record<string, unknown>;

  for (const stage of STAGES) {
    // Run the stage
    const output = await step.run(`stage-${stage}`, () =>
      runStage(stage, {
        jobId: job.id,
        brief: {
          productDescription: job.productDescription,
          targetAudience: job.targetAudience,
          platforms: job.platforms,
          brandVoice: job.brandVoice,
        },
        previousOutputs: stageOutputs,
        apiKey: llmConfig.apiKey,
      }),
    );

    // Persist output
    stageOutputs = { ...stageOutputs, [stage]: output };
    const nextStage = getNextStage(stage);

    await step.run(`save-${stage}`, () => jobStore.updateStage(job.id, nextStage, stageOutputs));

    // After the last stage, no approval needed
    if (nextStage === "complete") break;

    // Wait for buyer approval before proceeding
    const approval = await step.waitForEvent(`wait-approval-${stage}`, {
      event: "creative-pipeline/stage.approved",
      timeout: APPROVAL_TIMEOUT,
      match: "data.jobId",
    });

    // Timeout or explicit stop → halt pipeline
    if (!approval || approval.data.action === "stop") {
      await step.run(`stop-at-${stage}`, () => jobStore.stop(job.id, stage));
      return;
    }
  }
}

/**
 * Inngest function definition. Wired into the serve handler in apps/api.
 * The jobStore and llmConfig dependencies are injected at registration time.
 */
export function createCreativeJobRunner(jobStore: JobStore, llmConfig: LLMConfig) {
  return inngestClient.createFunction(
    {
      id: "creative-job-runner",
      name: "Creative Pipeline Job Runner",
      retries: 3,
      triggers: [{ event: "creative-pipeline/job.submitted" }],
    },
    async ({ event, step }: { event: { data: JobEventData }; step: StepTools }) => {
      await executeCreativePipeline(event.data, step, jobStore, llmConfig);
    },
  );
}
