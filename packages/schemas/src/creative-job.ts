// packages/schemas/src/creative-job.ts
import { z } from "zod";

// ── Enums ──

export const CreativeJobStage = z.enum([
  "trends",
  "hooks",
  "scripts",
  "storyboard",
  "production",
  "complete",
]);
export type CreativeJobStage = z.infer<typeof CreativeJobStage>;

export const CreativeJobMode = z.enum(["polished", "ugc"]);
export type CreativeJobMode = z.infer<typeof CreativeJobMode>;

export const CreativePlatform = z.enum(["meta", "youtube", "tiktok"]);
export type CreativePlatform = z.infer<typeof CreativePlatform>;

export const AwarenessLevel = z.enum([
  "unaware",
  "problem_aware",
  "solution_aware",
  "product_aware",
  "most_aware",
]);
export type AwarenessLevel = z.infer<typeof AwarenessLevel>;

export const HookType = z.enum(["pattern_interrupt", "question", "bold_statement"]);
export type HookType = z.infer<typeof HookType>;

// ── Stage Outputs ──

export const TrendAnalysisOutput = z.object({
  angles: z.array(
    z.object({
      theme: z.string(),
      motivator: z.string(),
      platformFit: z.string(),
      rationale: z.string(),
    }),
  ),
  audienceInsights: z.object({
    awarenessLevel: AwarenessLevel,
    topDrivers: z.array(z.string()),
    objections: z.array(z.string()),
  }),
  trendSignals: z.array(
    z.object({
      platform: z.string(),
      trend: z.string(),
      relevance: z.string(),
    }),
  ),
});
export type TrendAnalysisOutput = z.infer<typeof TrendAnalysisOutput>;

export const HookGeneratorOutput = z.object({
  hooks: z.array(
    z.object({
      angleRef: z.string(),
      text: z.string(),
      type: HookType,
      platformScore: z.number(),
      rationale: z.string(),
    }),
  ),
  topCombos: z.array(
    z.object({
      angleRef: z.string(),
      hookRef: z.string(),
      score: z.number(),
    }),
  ),
});
export type HookGeneratorOutput = z.infer<typeof HookGeneratorOutput>;

export const AdFormat = z.enum(["feed_video", "stories", "skippable", "shorts"]);
export type AdFormat = z.infer<typeof AdFormat>;

export const ScriptSection = z.enum(["hook", "problem", "solution", "proof", "cta"]);
export type ScriptSection = z.infer<typeof ScriptSection>;

export const ScriptWriterOutput = z.object({
  scripts: z.array(
    z.object({
      hookRef: z.string(),
      fullScript: z.string(),
      timing: z.array(
        z.object({
          section: ScriptSection,
          startSec: z.number(),
          endSec: z.number(),
          content: z.string(),
        }),
      ),
      format: AdFormat,
      platform: z.string(),
      productionNotes: z.string(),
    }),
  ),
});
export type ScriptWriterOutput = z.infer<typeof ScriptWriterOutput>;

export const StoryboardOutput = z.object({
  storyboards: z.array(
    z.object({
      scriptRef: z.string(),
      scenes: z.array(
        z.object({
          sceneNumber: z.number(),
          description: z.string(),
          visualDirection: z.string(),
          duration: z.number(),
          textOverlay: z.string().nullable(),
          referenceImageUrl: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type StoryboardOutput = z.infer<typeof StoryboardOutput>;

export const ProductionTier = z.enum(["basic", "pro", "premium"]);
export type ProductionTier = z.infer<typeof ProductionTier>;

export const VideoProducerOutput = z.object({
  tier: ProductionTier,
  clips: z.array(
    z.object({
      sceneRef: z.string(),
      videoUrl: z.string(),
      duration: z.number(),
      generatedBy: z.enum(["kling", "heygen"]),
    }),
  ),
  assembledVideos: z
    .array(
      z.object({
        videoUrl: z.string(),
        thumbnailUrl: z.string(),
        format: z.string(),
        duration: z.number(),
        platform: z.string(),
        hasVoiceover: z.boolean(),
        hasCaptions: z.boolean(),
        hasBackgroundMusic: z.boolean(),
      }),
    )
    .optional(),
  voiceover: z
    .object({
      audioUrl: z.string(),
      duration: z.number(),
      captionsUrl: z.string(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        stage: z.enum(["generation", "assembly", "voiceover", "captions"]),
        scene: z.string().nullable(),
        tool: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
  durableAssetUrl: z.string().optional(),
});
export type VideoProducerOutput = z.infer<typeof VideoProducerOutput>;

export const StageOutputs = z.object({
  trends: TrendAnalysisOutput.optional(),
  hooks: HookGeneratorOutput.optional(),
  scripts: ScriptWriterOutput.optional(),
  storyboard: StoryboardOutput.optional(),
  production: VideoProducerOutput.optional(),
});
export type StageOutputs = z.infer<typeof StageOutputs>;

// ── Creative Brief (input) ──

export const CreativeBriefInput = z.object({
  productDescription: z.string().min(1),
  targetAudience: z.string().min(1),
  platforms: z.array(CreativePlatform).min(1),
  brandVoice: z.string().nullable().optional(),
  productImages: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
  pastPerformance: z.record(z.unknown()).nullable().optional(),
  generateReferenceImages: z.boolean().default(false),
});
export type CreativeBriefInput = z.infer<typeof CreativeBriefInput>;

// ── Publish handoff input (Seam 2: Mira -> Ads) ──

/**
 * Seam 2 (Mira -> Ads) publish handoff payload. Deliberately minimal: the
 * creative-publish workflow re-derives platforms, the durable asset, the Meta
 * connection, and the page id from the persisted CreativeJob + connection.
 * Keeping the input at { jobId } is what makes the publish seam idempotent and
 * replay-safe (Governed Handoff Contract Freeze §4.2).
 */
export const CreativeJobPublishInput = z.object({
  jobId: z.string().min(1),
});
export type CreativeJobPublishInput = z.infer<typeof CreativeJobPublishInput>;

// ── Creative Job (full record) ──

export const CreativeJobSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  organizationId: z.string(),
  deploymentId: z.string(),
  productDescription: z.string(),
  targetAudience: z.string(),
  platforms: z.array(z.string()),
  brandVoice: z.string().nullable(),
  productImages: z.array(z.string()),
  references: z.array(z.string()),
  pastPerformance: z.record(z.unknown()).nullable(),
  generateReferenceImages: z.boolean(),
  productionTier: ProductionTier.nullable().optional(),
  currentStage: CreativeJobStage,
  stageOutputs: z.record(z.unknown()),
  stoppedAt: z.string().nullable(),
  // Terminal failure marker for a retry-exhausted polished render (dead-letter
  // consumer write). Mirrors ugcFailure; null = not failed.
  stageFailure: z.record(z.unknown()).nullable().optional(),
  mode: CreativeJobMode.default("polished"),
  ugcPhase: z.string().nullable().optional(),
  ugcPhaseOutputs: z.record(z.unknown()).nullable().optional(),
  ugcPhaseOutputsVersion: z.string().nullable().optional(),
  ugcConfig: z.record(z.unknown()).nullable().optional(),
  ugcFailure: z.record(z.unknown()).nullable().optional(),
  reviewDecision: z.enum(["kept", "passed"]).nullable().optional(),
  reviewDecidedAt: z.coerce.date().nullable().optional(),
  // Slice-2 taste-sweep idempotency watermark: the OBSERVED reviewDecidedAt
  // last captured (never wall-clock now), so a re-decision during a sweep
  // stays strictly newer and is re-observed next run.
  tasteCapturedAt: z.coerce.date().nullable().optional(),
  // F4 revenue-proven promotion idempotency watermark: set once a measured creative
  // first crosses the promotion floors, so the daily sweep counts it exactly once.
  revenueProvenPromotedAt: z.coerce.date().nullable().optional(),
  // Meta publish (P2 parked draft package). All nullable/optional — populated only
  // by the creative.job.publish handler (and durableAssetUrl by PR A).
  metaVideoId: z.string().nullable().optional(),
  metaCampaignId: z.string().nullable().optional(),
  metaAdSetId: z.string().nullable().optional(),
  metaCreativeId: z.string().nullable().optional(),
  metaAdId: z.string().nullable().optional(),
  metaPublishStatus: z.string().nullable().optional(),
  durableAssetUrl: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CreativeJob = z.infer<typeof CreativeJobSchema>;

/**
 * Lifecycle values for the free-form `metaPublishStatus` column above. The
 * publish handler sets `parked_paused` at the terminal create-ad checkpoint; a
 * dead-lettered publish is marked `publish_failed` by the publish-failure
 * recorder so a retry-exhausted Meta draft is observable to the operator
 * instead of reading as "never published". Absent (null) = not published, or in
 * flight. Single-sourced here (Layer 1) so the api producer and the core read
 * model agree on the literals without a cross-layer import.
 */
export const CREATIVE_META_PUBLISH_STATUS = {
  parkedPaused: "parked_paused",
  publishFailed: "publish_failed",
} as const;
export type CreativeMetaPublishStatus =
  (typeof CREATIVE_META_PUBLISH_STATUS)[keyof typeof CREATIVE_META_PUBLISH_STATUS];

// ── Measured past performance (slice-2 attribution sweep) ──

/**
 * The attribution sweep's typed write into `CreativeJob.pastPerformance`.
 * `kind` is the discriminant against the brief-enrichment shape
 * (`performance_history`, slice-2 PR-B): the two shapes share the one Json
 * column and must NEVER cross-validate. Readers parse-do-not-cast and project
 * nothing on failure.
 */
export const CreativePastPerformanceSchema = z.object({
  kind: z.literal("measured_performance"),
  version: z.literal(1),
  /** ISO timestamp of the sweep that wrote this row. */
  asOf: z.string(),
  window: z.object({ from: z.string(), to: z.string(), days: z.number().int() }),
  /**
   * Derived from insight-row ABSENCE (Meta omits zero-delivery campaigns):
   * absent row = "no_delivery" (the expected state for every parked ad),
   * present row = "measured".
   */
  delivery: z.enum(["no_delivery", "measured"]),
  join: z.object({
    metaCampaignId: z.string(),
    metaAdId: z.string().nullable(),
    metaVideoId: z.string().nullable(),
  }),
  meta: z.object({
    // Meta-attributed, major currency units as Meta reports.
    spend: z.number(),
    impressions: z.number(),
    inlineLinkClicks: z.number(),
    inlineLinkClickCtr: z.number(),
    conversions: z.number(), // Meta-attributed conversions, NOT internal truth
    cpm: z.number(),
  }),
  booked: z.object({
    // Internal source of truth; BOTH fields aggregate over the SAME predicate
    // (type "booked" AND value > 0), matching queryBookedStatsByCampaign, so
    // the count can never be satisfied by zero-value bookings the sum excludes.
    valueCents: z.number().int(), // CENTS, never pre-normalized
    count: z.number().int(),
  }),
  /** null = "insufficient signal" (no value-positive booked records, or zero spend), never a fabricated 0. */
  trueRoas: z.number().nullable(),
  source: z.object({
    insights: z.literal("meta_campaign_insights"),
    conversions: z.literal("conversion_records"),
  }),
});
export type CreativePastPerformance = z.infer<typeof CreativePastPerformanceSchema>;

/**
 * Brief-enrichment shape written at submit when the caller passed no explicit
 * pastPerformance: the deployment's top measured creatives, aggregated for the
 * NEXT brief (slice-2 spec 3.8). Shares the CreativeJob.pastPerformance column
 * with CreativePastPerformanceSchema; the disjoint `kind` literals make
 * cross-validation structurally impossible (mutual-rejection test).
 */
export const CreativePerformanceHistorySchema = z.object({
  kind: z.literal("performance_history"),
  version: z.literal(1),
  generatedAt: z.string(),
  topPerformers: z
    .array(
      z.object({
        jobId: z.string(),
        descriptor: z.string(), // "polished:question" vocabulary (spec 3.5)
        trueRoas: z.number().nullable(),
        spend: z.number(),
        bookedValueCents: z.number().int(),
        window: z.object({ from: z.string(), to: z.string() }),
      }),
    )
    .max(3),
  summary: z.string(),
});
export type CreativePerformanceHistory = z.infer<typeof CreativePerformanceHistorySchema>;
