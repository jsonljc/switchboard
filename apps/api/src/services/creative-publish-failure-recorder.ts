import { z } from "zod";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import { inngestClient } from "@switchboard/creative-pipeline";
import { CREATIVE_META_PUBLISH_STATUS, type CreativeJob } from "@switchboard/schemas";
import type { PrismaCreativeJobStore } from "@switchboard/db";

/** Minimal Inngest step surface used here (mirrors creative-failure-recorder.ts). */
export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

/**
 * The dead-letter event data: the AsyncFailureEnvelope plus the `trigger`
 * passthrough makeOnFailureHandler adds (the original publish.requested data,
 * { jobId, organizationId }). Only jobId is essential; the rest is descriptive.
 */
const FailureEventSchema = z.object({
  trigger: z.object({ jobId: z.string() }).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  occurredAt: z.string().optional(),
  functionId: z.string().optional(),
});

export interface CreativePublishFailureRecorderDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "updatePublishFields">;
  failure: AsyncFailureContext;
}

/**
 * Failure-contract Class E (audit-only): a recorder failure must never recurse
 * into another `.failed` event. Exported so a test locks the doctrine-#7 contract.
 */
export const CREATIVE_PUBLISH_FAILURE_RECORDER_FAILURE_PARAMS = {
  functionId: "creative-publish-failure-recorder",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

/**
 * The publish lifecycle is already resolved when the paused draft parked
 * (success) or a prior dead-letter already marked it failed. Guarding both keeps
 * the write idempotent and stops a late-delivered `.failed` (from an earlier
 * attempt) from clobbering a subsequent successful re-publish.
 */
function isPublishResolved(job: CreativeJob): boolean {
  return (
    job.metaPublishStatus === CREATIVE_META_PUBLISH_STATUS.parkedPaused ||
    job.metaPublishStatus === CREATIVE_META_PUBLISH_STATUS.publishFailed
  );
}

/**
 * Consume a `creative.publish.failed` dead-letter and mark the job so a
 * retry-exhausted Meta publish is observable to the operator (D9-F3): the read
 * model surfaces `metaPublishStatus` as a publish-failed badge instead of the
 * job reading as "never published / in flight". The creative draft itself is
 * unharmed (render succeeded), so this writes ONLY the publish status, never a
 * stageFailure/ugcFailure terminal marker. The org for the scoped write comes
 * from the loaded row, never the event.
 */
export async function executeCreativePublishFailureRecorder(
  eventData: unknown,
  step: StepTools,
  deps: Pick<CreativePublishFailureRecorderDeps, "jobStore">,
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
  if (isPublishResolved(job)) return; // already parked or already marked failed

  await step.run("mark-publish-failed", () =>
    deps.jobStore.updatePublishFields(job.organizationId, jobId, {
      metaPublishStatus: CREATIVE_META_PUBLISH_STATUS.publishFailed,
    }),
  );
}

/**
 * Inngest function: triggers on the publish dead-letter only. The publish chain
 * (creative-publish-function.ts) emits `creative.publish.failed` on
 * retry-exhaustion; this consumer is its sole subscriber.
 */
export function createCreativePublishFailureRecorder(deps: CreativePublishFailureRecorderDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-publish-failure-recorder",
      name: "Creative Publish Failure Recorder",
      retries: 3,
      triggers: [{ event: "creative.publish.failed" }],
      onFailure: makeOnFailureHandler(
        CREATIVE_PUBLISH_FAILURE_RECORDER_FAILURE_PARAMS,
        deps.failure,
      ) as (arg: unknown) => Promise<void>,
    },
    async ({ event, step }: { event: { data: unknown }; step: unknown }) => {
      await executeCreativePublishFailureRecorder(event.data, step as unknown as StepTools, deps);
    },
  );
}
