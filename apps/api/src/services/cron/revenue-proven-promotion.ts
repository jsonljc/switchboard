import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  StaleVersionError,
  type AsyncFailureContext,
} from "@switchboard/core";
import {
  CreativePastPerformanceSchema,
  computeConfidenceScore,
  MAX_DEPLOYMENT_MEMORY_ENTRIES,
  type CreativePastPerformance,
} from "@switchboard/schemas";
import { extractCreativeDescriptor, type CreativeDescriptor } from "@switchboard/creative-pipeline";
import type { RevenueProvenCandidate } from "@switchboard/db";

// Local Inngest client (shared switchboard id; fans out to the single serve handler).
const inngestClient = new Inngest({ id: "switchboard" });

/**
 * PER-ORG fetch cap on the candidate query (P2-11). A single global cap let one
 * org's never-qualifying (below-floor / not-yet-measured, hence never-watermarked)
 * backlog fill the whole budget every run, starving lower-volume orgs fleet-wide.
 * The published-and-pending set per org is small at pilot scale; an org that
 * exceeds this has its tail re-fetched next run and is flagged via a saturation warn.
 */
export const REVENUE_PROVEN_PER_ORG_CAP = 500;

/**
 * Defensive bound on the number of orgs visited per run (the distinct pending-org
 * set). Far above pilot org counts; if hit, the sweep warns - a signal to add
 * round-robin across runs so the alphabetical tail is not deferred indefinitely.
 */
export const REVENUE_PROVEN_MAX_ORGS = 1000;

// Promotion floors (spec §3.3). USD major units; reviewed when the first real cohort exists.
export const REVENUE_PROVEN_MIN_SPEND = 50;
export const REVENUE_PROVEN_MIN_BOOKED_COUNT = 2;
export const REVENUE_PROVEN_MIN_TRUE_ROAS = 1.5;

const HOOK_PHRASE: Record<string, string> = {
  pattern_interrupt: "pattern-interrupt hooks",
  question: "question-style hooks",
  bold_statement: "bold-statement hooks",
  none: "no leading hook",
};

/**
 * All floors required. Each numeric is `Number.isFinite`-guarded: pastPerformance
 * is JSON-parsed external data and `z.number()` does not reject NaN, so a NaN would
 * silently pass a bare `>=` comparison (the NaN-blind-gate gotcha). The floors are
 * grounded in internal booked truth (booked.count/value come from ConversionRecords),
 * which is robust to the Meta conversion-denominator trust the (deferred) RevenueState
 * veto would guard — see spec §3.5.
 */
export function passesRevenueProvenFloors(perf: CreativePastPerformance): boolean {
  if (perf.delivery !== "measured") return false;
  const { spend } = perf.meta;
  const { count } = perf.booked;
  const roas = perf.trueRoas;
  return (
    Number.isFinite(spend) &&
    spend >= REVENUE_PROVEN_MIN_SPEND &&
    Number.isFinite(count) &&
    count >= REVENUE_PROVEN_MIN_BOOKED_COUNT &&
    typeof roas === "number" &&
    Number.isFinite(roas) &&
    roas >= REVENUE_PROVEN_MIN_TRUE_ROAS
  );
}

/**
 * `revenue_proven:{mode}_{segment}` (segment = ugc structure else hook), the same
 * descriptor vocabulary as `taste` without polarity. Matches the Mira consumer regex
 * `/^revenue_proven:(polished|ugc)_([a-z0-9_]+)$/` in builders/mira.ts.
 */
export function revenueProvenCanonicalKey(d: CreativeDescriptor): string {
  return `revenue_proven:${d.mode}_${d.structureId ?? d.hookType}`;
}

/**
 * PURE function of the bucket (spec §3.6 + feedback_deployment_memory_dedup_axis):
 * the unique constraint is (org, deployment, category, CONTENT) while we dedup by
 * canonicalKey, so deterministic content makes the constraint a per-bucket constraint
 * and a concurrent duplicate create surfaces as a catchable P2002. NO per-job data
 * (provenance is logged at promotion time, never stored in content).
 */
export function revenueProvenBucketContent(
  mode: string,
  hookType: string,
  structureId?: string,
): string {
  const segment = structureId ? `${structureId} structure` : (HOOK_PHRASE[hookType] ?? hookType);
  return `Revenue-proven: ${mode} creatives with ${segment} (attributed >= ${REVENUE_PROVEN_MIN_TRUE_ROAS}x ROAS)`;
}

export interface RevenueProvenMemoryStore {
  findByCategoryAndCanonicalKey(
    organizationId: string,
    deploymentId: string,
    category: string,
    canonicalKey: string,
  ): Promise<Array<{ id: string; sourceCount: number; confidence: number }>>;
  create(input: {
    organizationId: string;
    deploymentId: string;
    category: string;
    content: string;
    confidence?: number;
    canonicalKey?: string | null;
  }): Promise<unknown>;
  incrementConfidence(
    organizationId: string,
    id: string,
    newConfidence: number,
  ): Promise<{ id: string; sourceCount: number }>;
  countByDeployment(organizationId: string, deploymentId: string): Promise<number>;
  findEvictionCandidate(
    organizationId: string,
    deploymentId: string,
  ): Promise<{ id: string; confidence: number } | null>;
  delete(organizationId: string, id: string): Promise<void>;
}

export interface RevenueProvenPromotionDeps {
  failure: AsyncFailureContext;
  jobStore: {
    listRevenueProvenCandidateOrgIds(maxOrgs: number): Promise<string[]>;
    listRevenueProvenCandidates(
      organizationId: string,
      limit: number,
    ): Promise<RevenueProvenCandidate[]>;
    setRevenueProvenPromotedAt(organizationId: string, id: string, promotedAt: Date): Promise<void>;
  };
  memoryStore: RevenueProvenMemoryStore;
  now: () => Date;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface RevenueProvenPromotionSummary {
  /** Orgs visited this run (each got a fair per-org slice). */
  orgsProcessed: number;
  /** Orgs whose pending set hit the per-org cap (tail deferred to next run). */
  orgsSaturated: number;
  candidates: number;
  promoted: number;
  belowFloor: number;
  notMeasured: number;
  skippedFailures: number;
  bucketsCreated: number;
  bucketsIncremented: number;
  evictions: number;
  drops: number;
}

type UpsertOutcome = "created" | "created_with_eviction" | "incremented" | "dropped";

async function incrementBucket(
  deps: RevenueProvenPromotionDeps,
  organizationId: string,
  bucket: { id: string; sourceCount: number },
): Promise<void> {
  await deps.memoryStore.incrementConfidence(
    organizationId,
    bucket.id,
    computeConfidenceScore(bucket.sourceCount + 1, false),
  );
}

/**
 * One qualifying creative -> one bucket upsert. Mirrors creative-taste-sweep's
 * upsertTasteBucket (find -> increment-or-create, 500-cap eviction, P2002 re-find).
 * Duplicated rather than shared to keep the taste sweep byte-untouched (rule of
 * three: extract a shared helper at the next writer).
 */
async function upsertRevenueProvenBucket(
  deps: RevenueProvenPromotionDeps,
  job: RevenueProvenCandidate,
  canonicalKey: string,
  content: string,
): Promise<UpsertOutcome> {
  const rows = await deps.memoryStore.findByCategoryAndCanonicalKey(
    job.organizationId,
    job.deploymentId,
    "revenue_proven",
    canonicalKey,
  );
  const bucket =
    rows.length > 0 ? [...rows].sort((a, b) => b.sourceCount - a.sourceCount)[0]! : null;
  if (bucket) {
    await incrementBucket(deps, job.organizationId, bucket);
    return "incremented";
  }

  const newcomerConfidence = computeConfidenceScore(1, false);
  let evicted = false;
  const count = await deps.memoryStore.countByDeployment(job.organizationId, job.deploymentId);
  if (count >= MAX_DEPLOYMENT_MEMORY_ENTRIES) {
    const candidate = await deps.memoryStore.findEvictionCandidate(
      job.organizationId,
      job.deploymentId,
    );
    if (!candidate || newcomerConfidence <= candidate.confidence) return "dropped";
    try {
      await deps.memoryStore.delete(job.organizationId, candidate.id);
      evicted = true;
    } catch (err) {
      if (err instanceof StaleVersionError) return "dropped";
      throw err;
    }
  }

  try {
    await deps.memoryStore.create({
      organizationId: job.organizationId,
      deploymentId: job.deploymentId,
      category: "revenue_proven",
      canonicalKey,
      content,
      confidence: newcomerConfidence,
    });
    return evicted ? "created_with_eviction" : "created";
  } catch (err) {
    // Unique violation = a concurrent run created the bucket between our find and
    // create (content-pure makes this catchable): re-find and increment instead.
    if ((err as { code?: string }).code === "P2002") {
      const raced = await deps.memoryStore.findByCategoryAndCanonicalKey(
        job.organizationId,
        job.deploymentId,
        "revenue_proven",
        canonicalKey,
      );
      const racedBucket =
        raced.length > 0 ? [...raced].sort((a, b) => b.sourceCount - a.sourceCount)[0]! : null;
      if (racedBucket) {
        await incrementBucket(deps, job.organizationId, racedBucket);
        return "incremented";
      }
    }
    throw err;
  }
}

/**
 * Daily Riley-owned promotion sweep (spec §3.2). Reads already-persisted measured
 * pastPerformance (no external I/O), promotes creatives that cross the economic
 * floors into a revenue_proven bucket on the creative's own deployment (which Mira
 * reads), watermarking each promoted creative so it is counted exactly once. A
 * measured-but-below-floor creative is left un-watermarked for re-evaluation as its
 * performance grows; per-job try/catch isolates a bad row. At-least-once across a
 * crash between upsert and watermark (the taste-sweep trade-off). The SOLE
 * revenue_proven writer (pinned by revenue-proven-writer-boundary.test.ts).
 */
export async function executeRevenueProvenPromotion(
  deps: RevenueProvenPromotionDeps,
): Promise<RevenueProvenPromotionSummary> {
  const summary: RevenueProvenPromotionSummary = {
    orgsProcessed: 0,
    orgsSaturated: 0,
    candidates: 0,
    promoted: 0,
    belowFloor: 0,
    notMeasured: 0,
    skippedFailures: 0,
    bucketsCreated: 0,
    bucketsIncremented: 0,
    evictions: 0,
    drops: 0,
  };

  // Per-org fair-share (P2-11): visit every org with pending candidates and fetch
  // a bounded PER-ORG slice, so one high-volume org's never-qualifying (and thus
  // never-watermarked) backlog can never fill a single global cap and starve
  // lower-volume orgs fleet-wide. The watermark idempotency is unchanged: a
  // promoted creative drops out of the pending predicate and is never re-counted.
  const orgIds = await deps.jobStore.listRevenueProvenCandidateOrgIds(REVENUE_PROVEN_MAX_ORGS);
  if (orgIds.length >= REVENUE_PROVEN_MAX_ORGS) {
    deps.logger.warn({
      msg: "revenue-proven-promotion: org cap reached; alphabetical tail deferred to next run",
      maxOrgs: REVENUE_PROVEN_MAX_ORGS,
    });
  }

  for (const organizationId of orgIds) {
    const candidates = await deps.jobStore.listRevenueProvenCandidates(
      organizationId,
      REVENUE_PROVEN_PER_ORG_CAP,
    );
    summary.orgsProcessed += 1;
    summary.candidates += candidates.length;
    if (candidates.length >= REVENUE_PROVEN_PER_ORG_CAP) {
      summary.orgsSaturated += 1;
      deps.logger.warn({
        msg: "revenue-proven-promotion: per-org cap saturated; org tail deferred to next run",
        organizationId,
        perOrgCap: REVENUE_PROVEN_PER_ORG_CAP,
      });
    }

    for (const job of candidates) {
      try {
        const parsed = CreativePastPerformanceSchema.safeParse(job.pastPerformance);
        if (!parsed.success || parsed.data.delivery !== "measured") {
          summary.notMeasured += 1;
          continue; // attribution not yet measured -> re-evaluate next run (no watermark)
        }
        if (!passesRevenueProvenFloors(parsed.data)) {
          summary.belowFloor += 1;
          continue; // below floors now; performance may still grow (no watermark)
        }

        const mode = job.mode === "ugc" ? "ugc" : "polished";
        const descriptor = extractCreativeDescriptor(
          mode === "ugc" ? job.ugcPhaseOutputs : job.stageOutputs,
          mode,
        );
        const canonicalKey = revenueProvenCanonicalKey(descriptor);
        const content = revenueProvenBucketContent(
          descriptor.mode,
          descriptor.hookType,
          descriptor.structureId,
        );

        const outcome = await upsertRevenueProvenBucket(deps, job, canonicalKey, content);
        if (outcome === "created" || outcome === "created_with_eviction") {
          summary.bucketsCreated += 1;
          if (outcome === "created_with_eviction") summary.evictions += 1;
        } else if (outcome === "incremented") {
          summary.bucketsIncremented += 1;
        } else {
          summary.drops += 1;
        }

        // Watermark once promoted (any non-error outcome): the creative has been
        // counted into its bucket; never re-count it on a later daily run.
        await deps.jobStore.setRevenueProvenPromotedAt(job.organizationId, job.id, deps.now());
        summary.promoted += 1;
        // Provenance to the structured log (NOT into content -- the dedup axis): a
        // revenue_proven memory is traceable to the rows that earned it here.
        deps.logger.info({
          msg: "revenue-proven-promotion: promoted",
          jobId: job.id,
          deploymentId: job.deploymentId,
          canonicalKey,
          campaignId: parsed.data.join.metaCampaignId,
          videoId: parsed.data.join.metaVideoId,
          spend: parsed.data.meta.spend,
          bookedValueCents: parsed.data.booked.valueCents,
          bookedCount: parsed.data.booked.count,
          trueRoas: parsed.data.trueRoas,
          outcome,
        });
      } catch (err) {
        summary.skippedFailures += 1;
        deps.logger.warn({ msg: "revenue-proven-promotion: job skipped", jobId: job.id, err });
      }
    }
  }

  deps.logger.info({ msg: "revenue-proven-promotion-summary", ...summary });
  return summary;
}

/** Class-E failure contract (attribution-pair convention): audit-record always; no event, no alert. */
export const REVENUE_PROVEN_PROMOTION_FAILURE_PARAMS = {
  functionId: "creative-revenue-proven-promotion",
  eventDomain: "creative.revenue_proven",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

export function createRevenueProvenPromotion(deps: RevenueProvenPromotionDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-revenue-proven-promotion",
      name: "Creative Revenue-Proven Promotion (measured performance -> revenue_proven memory)",
      retries: 2,
      triggers: [{ cron: "0 7 * * *" }],
      onFailure: makeOnFailureHandler(REVENUE_PROVEN_PROMOTION_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async () => executeRevenueProvenPromotion(deps),
  );
}
