import { Inngest } from "inngest";
import {
  makeOnFailureHandler,
  StaleVersionError,
  type AsyncFailureContext,
} from "@switchboard/core";
import { computeConfidenceScore, MAX_DEPLOYMENT_MEMORY_ENTRIES } from "@switchboard/schemas";
import { extractCreativeDescriptor } from "@switchboard/creative-pipeline";
import type { TasteCandidate } from "@switchboard/db";

// Local Inngest client. All function registrations in apps/api share the same
// switchboard id; they fan out to the single serve handler in bootstrap/inngest.ts.
const inngestClient = new Inngest({ id: "switchboard" });

/** FETCH cap on the candidates query (spec 3.6: the decided set is small). */
export const CANDIDATE_FETCH_CAP = 500;

const HOOK_PHRASE: Record<string, string> = {
  pattern_interrupt: "pattern-interrupt hooks",
  question: "question-style hooks",
  bold_statement: "bold-statement hooks",
  none: "no leading hook",
};

/**
 * PURE function of the bucket; load-bearing, not cosmetic (spec 3.5): the DB
 * unique constraint is (organizationId, deploymentId, category, CONTENT) while
 * the sweep dedups by canonicalKey. Deterministic content makes content
 * equivalent to the bucket, so the constraint enforces one row per bucket and
 * a concurrent duplicate create surfaces as a catchable unique violation.
 */
export function bucketContent(
  decision: string,
  mode: string,
  hookType: string,
  structureId?: string,
): string {
  // UGC buckets key by structure (slice-3 spec 3.4): the structure id IS the
  // ugc creative taxonomy; hooks do not exist for ugc.
  if (structureId) {
    return `Operator ${decision} ${mode} creatives with ${structureId} structure`;
  }
  return `Operator ${decision} ${mode} creatives with ${HOOK_PHRASE[hookType] ?? hookType}`;
}

export interface TasteSweepMemoryStore {
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

export interface CreativeTasteSweepDeps {
  failure: AsyncFailureContext;
  jobStore: {
    listTasteCandidates(limit: number): Promise<TasteCandidate[]>;
    setTasteCapturedAt(organizationId: string, id: string, observedDecidedAt: Date): Promise<void>;
  };
  memoryStore: TasteSweepMemoryStore;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface TasteSweepSummary {
  candidates: number;
  captured: number;
  skippedFailures: number;
  bucketsCreated: number;
  bucketsIncremented: number;
  evictions: number;
  drops: number;
}

type UpsertOutcome = "created" | "created_with_eviction" | "incremented" | "dropped";

async function incrementBucket(
  deps: CreativeTasteSweepDeps,
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
 * One gesture observation -> one bucket upsert (spec 3.5/3.6). Steady state is
 * one row per bucket (deterministic content); defensively pick the highest-
 * sourceCount row if ever plural. Cap-admission mirrors compounding-service:
 * at the 500-entry cap a NEW bucket is admitted only by evicting a strictly
 * weaker candidate, else the memory write is dropped (the gesture is still
 * watermarked: it was observed; the memory is full).
 */
async function upsertTasteBucket(
  deps: CreativeTasteSweepDeps,
  job: TasteCandidate,
  canonicalKey: string,
  content: string,
): Promise<UpsertOutcome> {
  const rows = await deps.memoryStore.findByCategoryAndCanonicalKey(
    job.organizationId,
    job.deploymentId,
    "taste",
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
      // Candidate vanished under a concurrent writer: drop rather than push
      // past the cap (the compounding-service convention).
      if (err instanceof StaleVersionError) return "dropped";
      throw err;
    }
  }

  try {
    await deps.memoryStore.create({
      organizationId: job.organizationId,
      deploymentId: job.deploymentId,
      category: "taste",
      canonicalKey,
      content,
      confidence: newcomerConfidence,
    });
    return evicted ? "created_with_eviction" : "created";
  } catch (err) {
    // Unique violation = a concurrent run created the bucket between our find
    // and create (the content-pure design makes this catchable): re-find and
    // increment instead (spec 3.5, deployment-memory dedup axis).
    if ((err as { code?: string }).code === "P2002") {
      const raced = await deps.memoryStore.findByCategoryAndCanonicalKey(
        job.organizationId,
        job.deploymentId,
        "taste",
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
 * Watermarked daily taste sweep (spec 3.6): the mira-decision route stays
 * byte-untouched; the CreativeJob review columns ARE the durable event record
 * and this sweep is the projector. Per-job try/catch so one bad job skips,
 * never aborts the run; the watermark stores the OBSERVED reviewDecidedAt and
 * advances only after the memory upsert, so a crash re-observes (at-least-once;
 * sourceCount inflation across a crash window is the accepted trade-off of
 * recording observation history).
 */
export async function executeCreativeTasteSweep(
  deps: CreativeTasteSweepDeps,
): Promise<TasteSweepSummary> {
  const candidates = await deps.jobStore.listTasteCandidates(CANDIDATE_FETCH_CAP);

  const summary: TasteSweepSummary = {
    candidates: candidates.length,
    captured: 0,
    skippedFailures: 0,
    bucketsCreated: 0,
    bucketsIncremented: 0,
    evictions: 0,
    drops: 0,
  };

  for (const job of candidates) {
    const observedDecidedAt = job.reviewDecidedAt; // capture BEFORE any write
    const decision = job.reviewDecision;
    if (!observedDecidedAt || (decision !== "kept" && decision !== "passed")) continue;
    try {
      const mode = job.mode === "ugc" ? "ugc" : "polished";
      // Mode-correct outputs (slice-3 spec 3.4): ugc content lives in
      // ugcPhaseOutputs; the polished column stays empty for ugc jobs.
      const descriptor = extractCreativeDescriptor(
        mode === "ugc" ? job.ugcPhaseOutputs : job.stageOutputs,
        mode,
      );
      // Third segment: the ugc structure when present, else the hook bucket.
      const segment = descriptor.structureId ?? descriptor.hookType;
      const canonicalKey = `taste:${decision}_${descriptor.mode}_${segment}`;
      const content = bucketContent(
        decision,
        descriptor.mode,
        descriptor.hookType,
        descriptor.structureId,
      );

      const outcome = await upsertTasteBucket(deps, job, canonicalKey, content);
      if (outcome === "created" || outcome === "created_with_eviction") {
        summary.bucketsCreated += 1;
        if (outcome === "created_with_eviction") summary.evictions += 1;
      } else if (outcome === "incremented") {
        summary.bucketsIncremented += 1;
      } else {
        summary.drops += 1;
      }

      await deps.jobStore.setTasteCapturedAt(job.organizationId, job.id, observedDecidedAt);
      summary.captured += 1;
    } catch (err) {
      summary.skippedFailures += 1;
      deps.logger.warn({ msg: "creative-taste-sweep: job skipped", jobId: job.id, err });
    }
  }

  deps.logger.info({ msg: "creative-taste-sweep-summary", ...summary });
  return summary;
}

/**
 * Class-E failure contract (the attribution-pair convention): the audit entry
 * is ALWAYS recorded; no domain event (zero consumers), no alert. The sweep
 * ships WITHOUT a kill-switch (spec 3.6): no external calls, derived data,
 * every write reversible via the memory delete API.
 */
export const CREATIVE_TASTE_SWEEP_FAILURE_PARAMS = {
  functionId: "creative-taste-sweep",
  eventDomain: "creative.taste",
  riskCategory: "low",
  alert: false,
  emitEvent: false,
} as const;

export function createCreativeTasteSweep(deps: CreativeTasteSweepDeps) {
  return inngestClient.createFunction(
    {
      id: "creative-taste-sweep",
      name: "Creative Taste Sweep (Keep/Pass -> taste memory)",
      retries: 2,
      triggers: [{ cron: "0 6 * * *" }],
      onFailure: makeOnFailureHandler(CREATIVE_TASTE_SWEEP_FAILURE_PARAMS, deps.failure) as (
        arg: unknown,
      ) => Promise<void>,
    },
    async () => executeCreativeTasteSweep(deps),
  );
}
