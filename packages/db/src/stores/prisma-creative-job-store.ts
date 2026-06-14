import { Prisma } from "@prisma/client";
import type { PrismaDbClient } from "../prisma-db.js";
import type { CreativeJob } from "@switchboard/schemas";
import { StaleVersionError } from "@switchboard/core";

export interface AttachIdentityRefsInput {
  productIdentityId: string;
  creatorIdentityId: string;
  effectiveTier: number;
  allowedOutputTier: number;
  shotSpecVersion: string;
  fidelityTierAtGeneration?: number;
}

export interface MarkRegistryBackfilledInput {
  productIdentityId: string;
  creatorIdentityId: string;
}

interface CreateCreativeJobInput {
  taskId: string;
  organizationId: string;
  deploymentId: string;
  productDescription: string;
  targetAudience: string;
  platforms: string[];
  brandVoice: string | null;
  productImages: string[];
  references: string[];
  pastPerformance: Record<string, unknown> | null;
  generateReferenceImages: boolean;
}

interface CreativeJobFilters {
  deploymentId?: string;
  currentStage?: string;
  limit?: number;
  offset?: number;
}

/** Narrow row the taste sweep consumes (slice 2): identity + descriptor inputs + watermark. */
export interface TasteCandidate {
  id: string;
  organizationId: string;
  deploymentId: string;
  mode: string;
  stageOutputs: unknown;
  /** UGC outputs (slice-3 spec 3.4): the descriptor's source for ugc jobs. */
  ugcPhaseOutputs: unknown;
  reviewDecision: string | null;
  reviewDecidedAt: Date | null;
  tasteCapturedAt: Date | null;
}

/** Narrow row the revenue-proven promotion consumes (F4): identity + descriptor inputs + measured perf. */
export interface RevenueProvenCandidate {
  id: string;
  organizationId: string;
  deploymentId: string;
  mode: string;
  stageOutputs: unknown;
  ugcPhaseOutputs: unknown;
  pastPerformance: unknown;
  metaCampaignId: string | null;
  metaVideoId: string | null;
}

export class PrismaCreativeJobStore {
  constructor(private prisma: PrismaDbClient) {}

  // ── Mode invariant helper ──

  private async assertMode(id: string, expectedMode: "polished" | "ugc"): Promise<void> {
    const job = await this.prisma.creativeJob.findUnique({ where: { id }, select: { mode: true } });
    if (!job) throw new Error(`Creative job not found: ${id}`);
    if (expectedMode === "ugc" && job.mode !== "ugc") {
      throw new Error("Cannot update UGC phase on a polished-mode job");
    }
    if (expectedMode === "polished" && job.mode === "ugc") {
      throw new Error("Cannot update polished stage on a UGC-mode job");
    }
  }

  async create(input: CreateCreativeJobInput): Promise<CreativeJob> {
    return this.prisma.creativeJob.create({
      data: {
        taskId: input.taskId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        platforms: input.platforms,
        brandVoice: input.brandVoice,
        productImages: input.productImages,
        references: input.references,
        pastPerformance: input.pastPerformance
          ? (input.pastPerformance as object)
          : Prisma.JsonNull,
        generateReferenceImages: input.generateReferenceImages,
      },
    }) as unknown as CreativeJob;
  }

  async findById(id: string): Promise<CreativeJob | null> {
    return this.prisma.creativeJob.findUnique({
      where: { id },
    }) as unknown as CreativeJob | null;
  }

  async findByTaskId(taskId: string): Promise<CreativeJob | null> {
    return this.prisma.creativeJob.findUnique({
      where: { taskId },
    }) as unknown as CreativeJob | null;
  }

  async listByOrg(organizationId: string, filters?: CreativeJobFilters): Promise<CreativeJob[]> {
    return this.prisma.creativeJob.findMany({
      where: {
        organizationId,
        ...(filters?.deploymentId ? { deploymentId: filters.deploymentId } : {}),
        ...(filters?.currentStage ? { currentStage: filters.currentStage } : {}),
      },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      orderBy: { createdAt: "desc" },
    }) as unknown as CreativeJob[];
  }

  async updateStage(
    organizationId: string,
    id: string,
    stage: string,
    stageOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "polished");
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: {
        currentStage: stage,
        stageOutputs: stageOutputs as object,
        // Forward progress clears any prior terminal marker: a replayed run that
        // advances is no longer failed (self-heal; see failPolished).
        stageFailure: Prisma.JsonNull,
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  async stop(organizationId: string, id: string, stoppedAt: string): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { stoppedAt },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  async updateProductionTier(
    organizationId: string,
    id: string,
    tier: string,
  ): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { productionTier: tier },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  /**
   * Persist a terminal failure marker on a polished job (dead-letter consumer
   * write). Mirrors failUgc for the polished lifecycle: a retry-exhausted render
   * reads as failed instead of a zombie awaiting_review. Org-scoped updateMany
   * (doctrine #12); count===0 ⇒ missing/cross-org ⇒ StaleVersionError.
   */
  async failPolished(
    organizationId: string,
    id: string,
    failure: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "polished");
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { stageFailure: failure as object },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  /**
   * Persist Meta publish checkpoint fields. Org-scoped updateMany (doctrine #12);
   * count===0 ⇒ missing/cross-org ⇒ throw. Called once per Meta object created so
   * the publish handler is resumable (each id is a checkpoint).
   */
  async updatePublishFields(
    organizationId: string,
    id: string,
    fields: Partial<
      Pick<
        CreativeJob,
        | "metaVideoId"
        | "metaCampaignId"
        | "metaAdSetId"
        | "metaCreativeId"
        | "metaAdId"
        | "metaPublishStatus"
      >
    >,
  ): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: fields,
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  /**
   * Persist the durable assembled-creative URL (PR A producer write). Org-scoped
   * updateMany (doctrine #12); count===0 ⇒ missing/cross-org ⇒ throw. Consumed by
   * the creative.job.publish precondition (assertPublishable).
   */
  async setDurableAsset(organizationId: string, id: string, url: string): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { durableAssetUrl: url },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  /**
   * Persist the attribution sweep's measured-performance snapshot (slice 2).
   * Org-scoped updateMany (doctrine #12); count===0 ⇒ missing/cross-org ⇒
   * throw StaleVersionError (the sweep treats it as a benign vanished-job
   * skip). Returns void: the daily sweep writes every published job and never
   * needs the row back (unlike the publish checkpoints above).
   */
  async setPastPerformance(
    organizationId: string,
    id: string,
    performance: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { pastPerformance: performance as object },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  /**
   * Published jobs = those with a Meta campaign checkpoint (set by the slice-1
   * publish path). The attribution sweep's working set; oldest first so window
   * derivation reads the earliest createdAt naturally.
   */
  async listPublished(organizationId: string): Promise<CreativeJob[]> {
    return this.prisma.creativeJob.findMany({
      where: { organizationId, metaCampaignId: { not: null } },
      orderBy: { createdAt: "asc" },
    }) as unknown as CreativeJob[];
  }

  /**
   * F4 revenue-proven promotion candidates: published jobs not yet promoted. The
   * `revenueProvenPromotedAt: null` predicate makes the FETCH cap bound PENDING
   * work, never history (promoted jobs drop out). Measured-state and the economic
   * floors are applied in JS by the sweep (pastPerformance is JSON). Cross-org
   * read (system cron); every WRITE stays org-scoped. Scale note: at pilot volume
   * the published-job set per org is far under the cap; revisit (a measured-only
   * index / per-org dispatch) only if a single org accumulates more
   * measured-but-non-qualifying published jobs than the cap.
   */
  async listRevenueProvenCandidates(limit: number): Promise<RevenueProvenCandidate[]> {
    return this.prisma.creativeJob.findMany({
      where: { metaCampaignId: { not: null }, revenueProvenPromotedAt: null },
      select: {
        id: true,
        organizationId: true,
        deploymentId: true,
        mode: true,
        stageOutputs: true,
        ugcPhaseOutputs: true,
        pastPerformance: true,
        metaCampaignId: true,
        metaVideoId: true,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    }) as unknown as RevenueProvenCandidate[];
  }

  /**
   * F4 promotion idempotency watermark: set once a job's measured performance
   * first crosses the floors, so the daily sweep never re-counts it. Org-scoped
   * updateMany (doctrine #12); count===0 ⇒ missing/cross-org ⇒ StaleVersionError
   * (the sweep treats it as a benign vanished-job skip).
   */
  async setRevenueProvenPromotedAt(
    organizationId: string,
    id: string,
    promotedAt: Date,
  ): Promise<void> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { revenueProvenPromotedAt: promotedAt },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  /**
   * Slice-2 taste-sweep watermark: stores the OBSERVED reviewDecidedAt (never
   * wall-clock), so a re-decision landing mid-sweep stays strictly newer and
   * is re-observed next run. Org-scoped updateMany (doctrine #12); count===0
   * throws StaleVersionError.
   */
  async setTasteCapturedAt(
    organizationId: string,
    id: string,
    observedDecidedAt: Date,
  ): Promise<void> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { tasteCapturedAt: observedDecidedAt },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
  }

  /**
   * Decided jobs whose gesture is not yet captured: tasteCapturedAt null OR
   * reviewDecidedAt strictly newer. Two legs so the SQL cap bounds PENDING
   * work, never history (an oldest-first cap over ALL decided rows would fill
   * with already-captured rows once lifetime decisions exceed it and silently
   * starve new gestures forever):
   *
   *   leg 1: never-captured rows (tasteCapturedAt null), oldest decision
   *          first — the dominant case, fully SQL-bounded.
   *   leg 2: captured rows, NEWEST decision first — a pending re-decision has
   *          a fresh reviewDecidedAt by construction (the route stamps now()
   *          on every decision write), so it always sorts into the window;
   *          the column-to-column watermark compare (not expressible in a
   *          Prisma where) runs in JS on this bounded set.
   *
   * Merged oldest-decision-first. Cross-org by design (system cron read);
   * every WRITE stays org-scoped per row.
   */
  async listTasteCandidates(limit: number): Promise<TasteCandidate[]> {
    const select = {
      id: true,
      organizationId: true,
      deploymentId: true,
      mode: true,
      stageOutputs: true,
      ugcPhaseOutputs: true,
      reviewDecision: true,
      reviewDecidedAt: true,
      tasteCapturedAt: true,
    } as const;

    const uncaptured = (await this.prisma.creativeJob.findMany({
      where: { reviewDecision: { not: null }, tasteCapturedAt: null },
      select,
      orderBy: { reviewDecidedAt: "asc" },
      take: limit,
    })) as TasteCandidate[];

    const captured = (await this.prisma.creativeJob.findMany({
      where: { reviewDecision: { not: null }, tasteCapturedAt: { not: null } },
      select,
      orderBy: { reviewDecidedAt: "desc" },
      take: limit,
    })) as TasteCandidate[];

    const redecided = captured.filter(
      (r) =>
        r.reviewDecidedAt != null &&
        r.tasteCapturedAt != null &&
        r.reviewDecidedAt.getTime() > r.tasteCapturedAt.getTime(),
    );

    return [...uncaptured.filter((r) => r.reviewDecidedAt != null), ...redecided]
      .sort((a, b) => a.reviewDecidedAt!.getTime() - b.reviewDecidedAt!.getTime())
      .slice(0, limit);
  }

  // ── UGC methods ──

  async createUgc(
    input: CreateCreativeJobInput & { ugcConfig: Record<string, unknown> },
  ): Promise<CreativeJob> {
    return this.prisma.creativeJob.create({
      data: {
        taskId: input.taskId,
        organizationId: input.organizationId,
        deploymentId: input.deploymentId,
        productDescription: input.productDescription,
        targetAudience: input.targetAudience,
        platforms: input.platforms,
        brandVoice: input.brandVoice,
        productImages: input.productImages,
        references: input.references,
        pastPerformance: input.pastPerformance
          ? (input.pastPerformance as object)
          : Prisma.JsonNull,
        generateReferenceImages: input.generateReferenceImages,
        mode: "ugc",
        ugcPhase: "planning",
        ugcPhaseOutputs: {},
        ugcPhaseOutputsVersion: "v1",
        ugcConfig: input.ugcConfig as object,
      },
    }) as unknown as CreativeJob;
  }

  async updateUgcPhase(
    organizationId: string,
    id: string,
    phase: string,
    phaseOutputs: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: {
        ugcPhase: phase,
        ugcPhaseOutputs: phaseOutputs as object,
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  async failUgc(
    organizationId: string,
    id: string,
    phase: string,
    error: Record<string, unknown>,
  ): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: {
        ugcPhase: phase,
        ugcFailure: error as object,
      },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  async stopUgc(organizationId: string, id: string, phase: string): Promise<CreativeJob> {
    await this.assertMode(id, "ugc");
    const result = await this.prisma.creativeJob.updateMany({
      where: { id, organizationId },
      data: { stoppedAt: phase, ugcPhase: phase },
    });
    if (result.count === 0) throw new StaleVersionError(id, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({ where: { id, organizationId } });
    return row as unknown as CreativeJob;
  }

  // ── Registry methods ──

  async attachIdentityRefs(
    organizationId: string,
    jobId: string,
    input: AttachIdentityRefsInput,
  ): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id: jobId, organizationId },
      data: {
        productIdentityId: input.productIdentityId,
        creatorIdentityId: input.creatorIdentityId,
        effectiveTier: input.effectiveTier,
        allowedOutputTier: input.allowedOutputTier,
        shotSpecVersion: input.shotSpecVersion,
        fidelityTierAtGeneration: input.fidelityTierAtGeneration,
      },
    });
    if (result.count === 0) throw new StaleVersionError(jobId, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({
      where: { id: jobId, organizationId },
    });
    return row as unknown as CreativeJob;
  }

  async markRegistryBackfilled(
    organizationId: string,
    jobId: string,
    input: MarkRegistryBackfilledInput,
  ): Promise<CreativeJob> {
    const result = await this.prisma.creativeJob.updateMany({
      where: { id: jobId, organizationId },
      data: {
        productIdentityId: input.productIdentityId,
        creatorIdentityId: input.creatorIdentityId,
        effectiveTier: 1,
        allowedOutputTier: 1,
        registryBackfilled: true,
        fidelityTierAtGeneration: 1,
      },
    });
    if (result.count === 0) throw new StaleVersionError(jobId, -1, -1);
    const row = await this.prisma.creativeJob.findFirstOrThrow({
      where: { id: jobId, organizationId },
    });
    return row as unknown as CreativeJob;
  }
}
