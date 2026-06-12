import { z } from "zod";
import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { WorkTraceStore, ExecutionError } from "@switchboard/core/platform";
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
  trigger: z.object({ jobId: z.string(), workUnitId: z.string().optional() }).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  occurredAt: z.string().optional(),
  functionId: z.string().optional(),
});

export interface CreativePublishFailureRecorderDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "updatePublishFields">;
  traceStore: Pick<WorkTraceStore, "getByWorkUnitId" | "update"> | null;
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

// Must match the intent the publish dispatcher is registered under
// (bootstrap/contained-workflows.ts). Used to reject a workUnitId that resolves to
// a non-publish trace of the same job (submit/continue share parameters.jobId).
const CREATIVE_PUBLISH_INTENT = "creative.job.publish";
const PUBLISH_FAILED_SUMMARY =
  "Meta publish failed after retries; the paused draft package was not created.";
const DEAD_LETTER_FALLBACK_CODE = "CREATIVE_PUBLISH_DEAD_LETTER";
const DEAD_LETTER_FALLBACK_MESSAGE = "Creative publish dead-lettered after retry exhaustion.";

/**
 * Both shapes of the store's lock rejection share this discriminator: the
 * `{ ok: false, code: "WORK_TRACE_LOCKED" }` production result and the
 * WorkTraceLockedError thrown when NODE_ENV is not production. Matching on the
 * code (not instanceof) avoids cross-package class-identity pitfalls.
 */
function isWorkTraceLockedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "WORK_TRACE_LOCKED"
  );
}

/**
 * Reconcile the canonical WorkTrace for a dead-lettered publish (D5-F1).
 * `executeAfterApproval` seals the trace at outcome "queued" when the dispatcher
 * hands off to async; left there forever it is a substrate lie (a terminally-
 * failed publish whose canonical record reads as still-in-flight). Flip the
 * THIS-ATTEMPT trace queued -> failed (a successful re-publish parks under a
 * different workUnitId/trace, so this never mislabels a success).
 *
 * `workUnitId` comes from a replayable, possibly stale or malformed dead-letter
 * event, so it is never trusted as a blind mutation pointer: the resolved trace
 * must be THIS org's PUBLISH trace for THIS job (org + parameters.jobId + intent)
 * before any write. Idempotent + no-clobber via the trace's own queued-gate; the
 * lock state machine also refuses a terminal clobber.
 */
export async function reconcilePublishTraceFailed(
  traceStore: Pick<WorkTraceStore, "getByWorkUnitId" | "update">,
  args: {
    workUnitId: string;
    organizationId: string;
    jobId: string;
    error: ExecutionError;
    completedAt?: string;
  },
): Promise<void> {
  const existing = await traceStore.getByWorkUnitId(args.workUnitId);
  if (!existing) {
    console.warn(
      `[creative-publish-failure-recorder] no WorkTrace ${args.workUnitId}; cannot reconcile publish outcome`,
    );
    return;
  }
  const trace = existing.trace;

  // Identity guards: a poisoned, stale, or malformed pointer must never become a
  // cross-work-unit mutation primitive. Any mismatch -> no-op, logged loudly.
  if (trace.organizationId !== args.organizationId) {
    console.error(
      `[creative-publish-failure-recorder] WorkTrace ${args.workUnitId} org ${trace.organizationId} != job org ${args.organizationId}; refusing cross-tenant reconcile`,
    );
    return;
  }
  if (trace.intent !== CREATIVE_PUBLISH_INTENT) {
    console.error(
      `[creative-publish-failure-recorder] WorkTrace ${args.workUnitId} intent ${trace.intent} != ${CREATIVE_PUBLISH_INTENT}; refusing wrong-action reconcile`,
    );
    return;
  }
  if (trace.parameters?.jobId !== args.jobId) {
    console.error(
      `[creative-publish-failure-recorder] WorkTrace ${args.workUnitId} jobId ${String(
        trace.parameters?.jobId,
      )} != ${args.jobId}; refusing wrong-job reconcile`,
    );
    return;
  }

  // Idempotency + no-clobber: only a still-"queued" trace is reconciled.
  if (trace.outcome !== "queued") return;

  try {
    const result = await traceStore.update(
      args.workUnitId,
      {
        outcome: "failed",
        error: args.error,
        executionSummary: PUBLISH_FAILED_SUMMARY,
        ...(args.completedAt ? { completedAt: args.completedAt } : {}),
      },
      { caller: "creative-publish-failure-recorder", organizationId: args.organizationId },
    );
    if (!result.ok) {
      // Production lock-rejection shape: a concurrent reconcile sealed the trace
      // terminal between our queued read and this write. Benign (already
      // resolved); log and move on.
      console.warn(
        `[creative-publish-failure-recorder] WorkTrace ${args.workUnitId} locked before reconcile (${result.reason}); left unchanged`,
      );
    }
  } catch (err) {
    // Non-production lock-rejection shape: the store THROWS WorkTraceLockedError
    // rather than returning { ok: false }. Same benign concurrent-seal conflict,
    // so swallow it. Any OTHER error is genuinely unexpected: rethrow so Inngest
    // retries (loud and self-healing), and the store has already recorded a
    // work_trace_locked_violation for the lock case.
    if (!isWorkTraceLockedError(err)) throw err;
    console.warn(
      `[creative-publish-failure-recorder] WorkTrace ${args.workUnitId} locked before reconcile (threw in non-production); left unchanged`,
    );
  }
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
  deps: Pick<CreativePublishFailureRecorderDeps, "jobStore" | "traceStore">,
): Promise<void> {
  const parsed = FailureEventSchema.safeParse(eventData);
  const data = parsed.success ? parsed.data : undefined;
  const jobId = data?.trigger?.jobId;
  if (!jobId) {
    // No entity id on the dead-letter (already audited by makeOnFailureHandler);
    // nothing actionable.
    return;
  }

  const job = await step.run("load-job", () => deps.jobStore.findById(jobId));
  if (!job) return; // vanished

  // Job-field honesty (operator surface, #996/#1002). Idempotent at the JOB level:
  // skip if the job already resolved (parked success, or a prior dead-letter mark).
  if (!isPublishResolved(job)) {
    await step.run("mark-publish-failed", () =>
      deps.jobStore.updatePublishFields(job.organizationId, jobId, {
        metaPublishStatus: CREATIVE_META_PUBLISH_STATUS.publishFailed,
      }),
    );
  }

  // Canonical-trace honesty (D5-F1). Runs INDEPENDENT of the job-state guard above:
  // a job already marked publish_failed must never suppress this and preserve the
  // "queued forever" trace lie. Idempotency/no-clobber is the trace's own queued-
  // gate (inside reconcilePublishTraceFailed), not the job guard. Org comes from the
  // loaded row, never the event. Skipped (logged) when the store is unwired or the
  // dead-letter predates the workUnitId passthrough.
  const { traceStore } = deps;
  const workUnitId = data?.trigger?.workUnitId;
  if (!traceStore) return;
  if (!workUnitId) {
    console.warn(
      `[creative-publish-failure-recorder] dead-letter for job ${jobId} carried no workUnitId; canonical WorkTrace not reconciled`,
    );
    return;
  }
  await step.run("reconcile-publish-trace", () =>
    reconcilePublishTraceFailed(traceStore, {
      workUnitId,
      organizationId: job.organizationId,
      jobId: job.id,
      error: {
        code: data?.code ?? DEAD_LETTER_FALLBACK_CODE,
        message: data?.message ?? DEAD_LETTER_FALLBACK_MESSAGE,
      },
      completedAt: data?.occurredAt,
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
