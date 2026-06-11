import { z } from "zod";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";
import type { CreativeJob } from "@switchboard/schemas";
import type { PrismaCreativeJobStore } from "@switchboard/db";

/** Minimal Inngest step surface used here (mirrors creative-publish-function.ts). */
export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

/**
 * The dead-letter event data: the AsyncFailureEnvelope plus the `trigger` passthrough
 * added by makeOnFailureHandler. Only jobId is essential; the rest is descriptive.
 */
const FailureEventSchema = z.object({
  trigger: z.object({ jobId: z.string() }).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  stage: z.string().optional(),
  occurredAt: z.string().optional(),
  functionId: z.string().optional(),
});

export interface CreativeFailureRecorderDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "failPolished" | "failUgc">;
  failure: AsyncFailureContext;
}

/**
 * Failure-contract Class E (audit-only): a recorder failure must never recurse into
 * another `.failed` event. Exported so a test locks the doctrine-#7 contract.
 */
export const CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS = {
  functionId: "creative-failure-recorder",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

/** A job is terminal (do not clobber) when it is stopped, complete, or already failed. */
function isTerminal(job: CreativeJob): boolean {
  if (job.stoppedAt != null) return true;
  if (job.mode === "ugc") return job.ugcPhase === "complete" || job.ugcFailure != null;
  return job.currentStage === "complete" || job.stageFailure != null;
}

/**
 * Consume a creative dead-letter and persist a terminal failure marker on the row
 * (D5-F1 / D9-F2). Mode-agnostic: branches on the LOADED job.mode, so one consumer
 * closes the polished and ugc zombies in one place. Idempotent: an already-terminal
 * job is skipped. The org for the scoped write comes from the loaded row, never the
 * event.
 */
export async function executeCreativeFailureRecorder(
  eventData: unknown,
  step: StepTools,
  deps: Pick<CreativeFailureRecorderDeps, "jobStore">,
): Promise<void> {
  const parsed = FailureEventSchema.safeParse(eventData);
  const jobId = parsed.success ? parsed.data.trigger?.jobId : undefined;
  if (!jobId) {
    // No entity id on the dead-letter (already audited by makeOnFailureHandler);
    // nothing actionable.
    return;
  }

  const job = await step.run("load-job", () => deps.jobStore.findById(jobId));
  if (!job) return; // vanished
  if (isTerminal(job)) return; // already terminal; do not clobber

  const env = parsed.success ? parsed.data : {};
  const failure: Record<string, unknown> = {
    kind: "terminal",
    code: env.code ?? "ASYNC_JOB_FAILED",
    message: env.message ?? "async job exhausted retries",
    ...(env.stage ? { stage: env.stage } : {}),
    ...(env.functionId ? { functionId: env.functionId } : {}),
    ...(env.occurredAt ? { occurredAt: env.occurredAt } : {}),
  };

  if (job.mode === "ugc") {
    await step.run("fail-ugc", () =>
      deps.jobStore.failUgc(job.organizationId, jobId, job.ugcPhase ?? "planning", failure),
    );
  } else {
    await step.run("fail-polished", () =>
      deps.jobStore.failPolished(job.organizationId, jobId, failure),
    );
  }
}

/**
 * Inngest function: triggers on both creative dead-letters. The polished runner emits
 * creative.polished.failed; a ugc runner OUT-OF-BAND failure emits creative.ugc.failed
 * (an in-band phase failure persists failUgc itself, so the two paths never both fire).
 */
export function createCreativeFailureRecorder(deps: CreativeFailureRecorderDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-failure-recorder",
      name: "Creative Failure Recorder",
      retries: 3,
      triggers: [{ event: "creative.polished.failed" }, { event: "creative.ugc.failed" }],
      onFailure: makeOnFailureHandler(CREATIVE_FAILURE_RECORDER_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async ({ event, step }: { event: { data: unknown }; step: unknown }) => {
      await executeCreativeFailureRecorder(event.data, step as unknown as StepTools, deps);
    },
  );
}
