import { makeOnFailureHandler, type AsyncFailureContext } from "@switchboard/core";
import type { WorkTraceStore } from "@switchboard/core/platform";
import { NonRetriableError } from "inngest";
import { inngestClient } from "@switchboard/creative-pipeline";
import type { MetaAdsClient } from "@switchboard/ad-optimizer";
import { CREATIVE_META_PUBLISH_STATUS, type CreativeJob } from "@switchboard/schemas";
import type { PrismaCreativeJobStore } from "@switchboard/db";
import type { PublishContext, PublishPrecheck } from "./creative-publish-preconditions.js";

/** Persisted lifecycle marker once the full paused draft package exists. */
export const PARKED_PAUSED = CREATIVE_META_PUBLISH_STATUS.parkedPaused;

/**
 * Canonical WorkTrace summary for a parked paused-draft package. Shared with the
 * dispatcher's synchronous already-parked short-circuit
 * (creative-publish-workflow.ts) so the async-park trace reads identically to the
 * sync one.
 */
export const PAUSED_DRAFT_SUMMARY =
  "Created paused Meta draft package (review & activate in Ads Manager)";

// Placeholder ad content the operator finalizes in Ads Manager (the locked "parked
// draft" framing). The campaign is PAUSED so the budget never spends. A currency-aware
// minimum budget is a documented go-live refinement (publish spec sections 6.6 / 11).
const MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS = 500; // ~5 units of account currency
const DRAFT_OBJECTIVE = "OUTCOME_LEADS";
const DRAFT_BID_STRATEGY = "LOWEST_COST_WITHOUT_CAP";
const DRAFT_OPTIMIZATION_GOAL = "LEAD_GENERATION";
const DRAFT_TARGETING: Record<string, unknown> = { geo_locations: { countries: ["SG"] } };
const DRAFT_CTA = "LEARN_MORE";
const DRAFT_LINK_PLACEHOLDER = "https://switchboard.example/finalize-in-ads-manager";

/** Minimal Inngest step surface used here (mirrors meta-token-refresh.ts). */
export interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

/** The MetaAdsClient subset the publish chain uses (so tests inject a mock). */
export type AdsClientLike = Pick<
  MetaAdsClient,
  | "uploadCreativeAsset"
  | "createDraftCampaign"
  | "createDraftAdSet"
  | "createAdCreative"
  | "createAd"
>;

export interface CreativePublishEventData {
  jobId: string;
  organizationId: string;
  /**
   * Originating WorkTrace work-unit id. Rides the dead-letter `trigger`
   * passthrough so the publish-failure recorder can reconcile the canonical
   * WorkTrace outcome (queued -> failed) for a retry-exhausted publish (D5-F1).
   * Optional: the publish chain never reads it, and events enqueued before this
   * field existed lack it.
   */
  workUnitId?: string;
}

export interface CreativePublishFunctionDeps {
  jobStore: Pick<PrismaCreativeJobStore, "findById" | "updatePublishFields">;
  assertPublishable: (organizationId: string, jobId: string) => Promise<PublishPrecheck>;
  makeAdsClient: (cfg: { accessToken: string; accountId: string }) => AdsClientLike;
  fetchAsset: (url: string) => Promise<{ buffer: Buffer; type: "image" | "video" }>;
  failure: AsyncFailureContext;
  /**
   * Canonical WorkTrace store, used to reconcile the publish trace
   * queued -> completed once the paused draft parks (the honest-success sibling
   * of the dead-letter queued -> failed reconcile in
   * creative-publish-failure-recorder.ts). Null when unwired: the publish itself
   * still parks; only the canonical-record reconcile is skipped. The Pick mirrors
   * the failure recorder's dependency surface.
   */
  traceStore: Pick<WorkTraceStore, "getByWorkUnitId" | "update"> | null;
}

/**
 * Failure-contract: record the audit entry, emit the `creative.publish.failed`
 * dead-letter (consumed by the publish-failure recorder, which marks
 * metaPublishStatus so the operator sees the failure), AND alert. This is a
 * human-approved action with a named owner, so a retry-exhausted publish alerts
 * at warning severity (a paused draft carries no live spend, so not critical).
 * Exported so a test locks the doctrine-#7 contract (event domain, risk, alert).
 *
 * NOTE: the alert is actionable only once OPERATOR_ALERT_WEBHOOK_URL is wired in
 * the deploy topology (render.yaml / provisioning runbook), a separate ops leg
 * (D9-F1). Until then NoopOperatorAlerter logs the dropped alert at error level,
 * so the failure is at least visible in host logs.
 */
export const CREATIVE_PUBLISH_FAILURE_PARAMS = {
  functionId: "creative-publish",
  eventDomain: "creative.publish",
  riskCategory: "medium",
  alert: true,
  severity: "warning",
} as const;

// Must match the intent the publish dispatcher is registered under
// (bootstrap/contained-workflows.ts) and the failure recorder's identity guard
// (creative-publish-failure-recorder.ts). Used to reject a workUnitId that
// resolves to a non-publish trace of the same job (submit/continue share
// parameters.jobId).
const CREATIVE_PUBLISH_INTENT = "creative.job.publish";

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
 * Reconcile the canonical WorkTrace for a successfully-parked publish: the
 * honest-success sibling of D5-F1's queued -> failed dead-letter reconcile in
 * creative-publish-failure-recorder.ts (keep the identity guards in sync).
 * `executeAfterApproval` seals the trace at outcome "queued" when the dispatcher
 * hands off to async; left there forever it is a substrate lie (a parked draft
 * whose canonical record reads as still-in-flight). Flip queued -> completed,
 * carrying the parked-draft outputs + summary so the async-park trace reads
 * identically to the dispatcher's synchronous already-parked short-circuit.
 *
 * `workUnitId` rides a replayable event, so it is never trusted as a blind
 * mutation pointer: the resolved trace must be THIS org's PUBLISH trace for THIS
 * job (org + intent + parameters.jobId) before any write. Idempotent + no-clobber
 * via the trace's own queued-gate; the lock state machine also refuses to clobber
 * a terminal outcome (e.g. a dead-letter that won the race).
 */
export async function reconcilePublishTraceCompleted(
  traceStore: Pick<WorkTraceStore, "getByWorkUnitId" | "update">,
  args: {
    workUnitId: string;
    organizationId: string;
    jobId: string;
    outputs: Record<string, string>;
    completedAt?: string;
  },
): Promise<void> {
  const existing = await traceStore.getByWorkUnitId(args.workUnitId);
  if (!existing) {
    console.warn(
      `[creative-publish] no WorkTrace ${args.workUnitId}; cannot reconcile publish success`,
    );
    return;
  }
  const trace = existing.trace;

  // Identity guards: a poisoned, stale, or malformed pointer must never become a
  // cross-work-unit mutation primitive. Any mismatch -> no-op, logged loudly.
  if (trace.organizationId !== args.organizationId) {
    console.error(
      `[creative-publish] WorkTrace ${args.workUnitId} org ${trace.organizationId} != job org ${args.organizationId}; refusing cross-tenant reconcile`,
    );
    return;
  }
  if (trace.intent !== CREATIVE_PUBLISH_INTENT) {
    console.error(
      `[creative-publish] WorkTrace ${args.workUnitId} intent ${trace.intent} != ${CREATIVE_PUBLISH_INTENT}; refusing wrong-action reconcile`,
    );
    return;
  }
  if (trace.parameters?.jobId !== args.jobId) {
    console.error(
      `[creative-publish] WorkTrace ${args.workUnitId} jobId ${String(
        trace.parameters?.jobId,
      )} != ${args.jobId}; refusing wrong-job reconcile`,
    );
    return;
  }

  // Idempotency + no-clobber: only a still-"queued" trace is reconciled. A second
  // delivery, or a dead-letter that already sealed the trace terminal, is a no-op.
  if (trace.outcome !== "queued") return;

  try {
    const result = await traceStore.update(
      args.workUnitId,
      {
        outcome: "completed",
        executionSummary: PAUSED_DRAFT_SUMMARY,
        executionOutputs: args.outputs,
        ...(args.completedAt ? { completedAt: args.completedAt } : {}),
      },
      { caller: "creative-publish", organizationId: args.organizationId },
    );
    if (!result.ok) {
      // Production lock-rejection shape: a concurrent reconcile (e.g. a late
      // dead-letter) sealed the trace terminal between our queued read and this
      // write. Benign (already resolved); log and move on.
      console.warn(
        `[creative-publish] WorkTrace ${args.workUnitId} locked before success reconcile (${result.reason}); left unchanged`,
      );
    }
  } catch (err) {
    // Non-production lock-rejection shape: the store THROWS WorkTraceLockedError
    // rather than returning { ok: false }. Same benign concurrent-seal conflict,
    // so swallow it. Any OTHER error is genuinely unexpected: rethrow so Inngest
    // retries (prior Meta steps are memoized, so the retry just re-attempts this
    // reconcile). In the rare sustained-store-outage tail (draft parked, reconcile
    // exhausts, dead-letter then marks the trace failed) the operator surface stays
    // correct (job is parked_paused) and the trace is terminal, not the prior
    // queued-forever lie.
    if (!isWorkTraceLockedError(err)) throw err;
    console.warn(
      `[creative-publish] WorkTrace ${args.workUnitId} locked before success reconcile (threw in non-production); left unchanged`,
    );
  }
}

function draftName(job: Pick<CreativeJob, "id" | "productDescription">): string {
  return `Mira draft — ${job.productDescription.slice(0, 40)} — ${job.id}`;
}

async function resolvePublishContext(
  deps: CreativePublishFunctionDeps,
  organizationId: string,
  jobId: string,
): Promise<PublishContext> {
  const pre = await deps.assertPublishable(organizationId, jobId);
  if (!pre.ok) {
    // Precondition failures are state-based, not transient. Do not burn Inngest retries
    // on a job that cannot become publishable; NonRetriableError dead-letters at once
    // with envelope.retryable=false.
    throw new NonRetriableError(`creative.publish blocked: ${pre.code}: ${pre.message}`);
  }
  return pre;
}

/**
 * The Meta publish call chain, isolated per object as a step.run checkpoint. Each step
 * reuses a metaId already persisted on the job, so the common retry / re-dispatch path
 * (checkpoint already written) creates no duplicate. One residual window remains: a crash
 * or DB-write failure BETWEEN a successful Meta create and its checkpoint write can orphan
 * a PAUSED object that a retry then recreates. Every object is PAUSED (no spend), so this
 * is benign; the operator deletes any stray draft in Ads Manager. Activation is unreachable
 * (createAd is PAUSED-only; updateCampaignStatus is never called here).
 *
 * Retry policy: a precondition failure throws NonRetriableError (no retries, immediate
 * dead-letter); a Meta-call failure propagates as a plain Error and is retried then
 * dead-lettered (transient-optimized for rate limits / 5xx / network). A permanent Meta
 * 4xx also consumes the retry budget, which is acceptable for a paused, no-spend draft;
 * failing those fast would need typed errors from MetaAdsClient (future).
 */
export async function executeCreativePublish(
  data: CreativePublishEventData,
  step: StepTools,
  deps: CreativePublishFunctionDeps,
): Promise<void> {
  const { jobId, organizationId } = data;

  // Resolved OUTSIDE step.run: re-reads on every (re)entry so fresh credentials are used,
  // and the decrypted access token is never serialized into Inngest step state.
  const pre = await resolvePublishContext(deps, organizationId, jobId);
  const ads = deps.makeAdsClient({ accessToken: pre.accessToken, accountId: pre.accountId });

  const metaVideoId = await step.run("upload-creative-asset", async () => {
    const current = await deps.jobStore.findById(jobId);
    if (current?.metaVideoId) return current.metaVideoId;
    const asset = await deps.fetchAsset(pre.durableAssetUrl);
    const v = await ads.uploadCreativeAsset({ file: asset.buffer, type: asset.type });
    await deps.jobStore.updatePublishFields(organizationId, jobId, { metaVideoId: v.id });
    return v.id;
  });

  const metaCampaignId = await step.run("create-draft-campaign", async () => {
    const current = await deps.jobStore.findById(jobId);
    if (current?.metaCampaignId) return current.metaCampaignId;
    const c = await ads.createDraftCampaign({
      name: draftName(pre.job),
      objective: DRAFT_OBJECTIVE,
      budget: { daily: MIN_VALID_PAUSED_DAILY_BUDGET_MINOR_UNITS },
      bidStrategy: DRAFT_BID_STRATEGY,
    });
    await deps.jobStore.updatePublishFields(organizationId, jobId, { metaCampaignId: c.id });
    return c.id;
  });

  const metaAdSetId = await step.run("create-draft-ad-set", async () => {
    const current = await deps.jobStore.findById(jobId);
    if (current?.metaAdSetId) return current.metaAdSetId;
    const s = await ads.createDraftAdSet({
      campaignId: metaCampaignId,
      name: draftName(pre.job),
      targeting: DRAFT_TARGETING,
      optimizationGoal: DRAFT_OPTIMIZATION_GOAL,
    });
    await deps.jobStore.updatePublishFields(organizationId, jobId, { metaAdSetId: s.id });
    return s.id;
  });

  const metaCreativeId = await step.run("create-ad-creative", async () => {
    const current = await deps.jobStore.findById(jobId);
    if (current?.metaCreativeId) return current.metaCreativeId;
    const cr = await ads.createAdCreative({
      name: draftName(pre.job),
      pageId: pre.pageId,
      videoId: metaVideoId,
      message: pre.job.productDescription,
      linkUrl: DRAFT_LINK_PLACEHOLDER,
      callToActionType: DRAFT_CTA,
    });
    await deps.jobStore.updatePublishFields(organizationId, jobId, { metaCreativeId: cr.id });
    return cr.id;
  });

  const metaAdId = await step.run("create-ad", async () => {
    const current = await deps.jobStore.findById(jobId);
    if (current?.metaAdId) return current.metaAdId;
    const a = await ads.createAd({
      name: draftName(pre.job),
      adSetId: metaAdSetId,
      creativeId: metaCreativeId,
    });
    // Terminal checkpoint: the ad id and the parked status persist together.
    await deps.jobStore.updatePublishFields(organizationId, jobId, {
      metaAdId: a.id,
      metaPublishStatus: PARKED_PAUSED,
    });
    return a.id;
  });

  // Canonical-record honesty: the paused draft package now exists, so flip the
  // WorkTrace executeAfterApproval sealed at "queued" to its terminal "completed"
  // (the honest-success sibling of the dead-letter queued -> failed reconcile).
  // A dedicated trailing step (not folded into create-ad, whose metaAdId early-
  // return would skip it on re-entry) so an Inngest retry re-runs it with the Meta
  // steps memoized; the queued-gate keeps it idempotent. Skipped when the trace
  // store is unwired or the event predates the workUnitId passthrough.
  const { traceStore } = deps;
  const { workUnitId } = data;
  if (traceStore && workUnitId) {
    await step.run("reconcile-publish-trace", () =>
      reconcilePublishTraceCompleted(traceStore, {
        workUnitId,
        organizationId,
        jobId,
        outputs: { metaAdId, metaAdSetId, metaCreativeId, metaCampaignId },
        completedAt: new Date().toISOString(),
      }),
    );
  }
}

/**
 * The dead-lettered `creative-publish` Inngest function. Triggered by
 * `creative-pipeline/publish.requested` (emitted by the governed publish handler after
 * mandatory human approval). Runs the rate-limited Meta chain off the request path, with
 * per-object step.run isolation and a doctrine-#7 onFailure dead-letter.
 */
export function createCreativePublishFunction(deps: CreativePublishFunctionDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-publish",
      name: "Creative Publish (paused Meta draft package)",
      retries: 3,
      triggers: [{ event: "creative-pipeline/publish.requested" }],
      onFailure: makeOnFailureHandler(CREATIVE_PUBLISH_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async ({ event, step }: { event: { data: CreativePublishEventData }; step: unknown }) => {
      await executeCreativePublish(event.data, step as unknown as StepTools, deps);
    },
  );
}
