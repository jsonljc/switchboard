// packages/schemas/src/ugc-job.ts
import { z } from "zod";
import { CreativeBriefInput } from "./creative-job.js";
import { ImperfectionProfileSchema } from "./creator-identity.js";
import { IdentityStrategy } from "./identity-strategy.js";

// ── Enums ──

export const UgcPhase = z.enum(["planning", "scripting", "production", "delivery", "complete"]);
export type UgcPhase = z.infer<typeof UgcPhase>;

export const UgcFormat = z.enum(["talking_head", "lifestyle", "product_in_hand", "multi_shot"]);
export type UgcFormat = z.infer<typeof UgcFormat>;

export const UgcPlatform = z.enum(["meta_feed", "instagram_reels", "tiktok"]);
export type UgcPlatform = z.infer<typeof UgcPlatform>;

export const UgcErrorKind = z.enum(["retryable", "terminal", "degraded"]);
export type UgcErrorKind = z.infer<typeof UgcErrorKind>;

// ── Error ──

export const UgcPhaseErrorSchema = z.object({
  kind: UgcErrorKind,
  phase: UgcPhase,
  code: z.string(),
  message: z.string(),
  context: z.record(z.unknown()).optional(),
});
export type UgcPhaseError = z.infer<typeof UgcPhaseErrorSchema>;

// ── UGC Brief (extends CreativeBriefInput) ──

export const UgcBriefSchema = CreativeBriefInput.extend({
  creatorPoolIds: z.array(z.string()),
  ugcFormat: UgcFormat,
  imperfectionProfile: ImperfectionProfileSchema.optional(),
});
export type UgcBrief = z.infer<typeof UgcBriefSchema>;

// ── UGC Config ──

export const UgcConfigSchema = z.object({
  brief: UgcBriefSchema,
  budget: z
    .object({
      totalJobBudget: z.number(),
      perSpecBudget: z.number().optional(),
      costAuthority: z.literal("estimated"),
    })
    .optional(),
  retryConfig: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(3),
      maxProviderFallbacks: z.number().int().min(0).max(5).default(2),
    })
    .optional(),
});
export type UgcConfig = z.infer<typeof UgcConfigSchema>;

// ── Scene Style & UGC Direction ──

export const SceneStyleSchema = z.object({
  lighting: z.enum(["natural", "ambient", "golden_hour", "overcast", "ring_light"]),
  cameraAngle: z.enum(["selfie", "eye_level", "slight_low", "over_shoulder"]),
  cameraMovement: z.enum(["handheld", "static_tripod", "slow_pan", "none"]),
  environment: z.string(),
  wardrobeSelection: z.array(z.string()),
  hairState: z.string(),
  props: z.array(z.string()),
});
export type SceneStyle = z.infer<typeof SceneStyleSchema>;

export const UgcDirectionSchema = z.object({
  hookType: z.enum(["direct_camera", "mid_action", "reaction", "text_overlay_start"]),
  eyeContact: z.enum(["camera", "off_camera", "mixed"]),
  energyLevel: z.enum(["low", "medium", "high"]),
  pacingNotes: z.string(),
  imperfections: ImperfectionProfileSchema,
  adLibPermissions: z.array(z.string()),
  forbiddenFraming: z.array(z.string()),
});
export type UgcDirection = z.infer<typeof UgcDirectionSchema>;

// ── Identity Constraints ──

export const IdentityConstraintsSchema = z.object({
  strategy: IdentityStrategy,
  requireExactReuse: z.boolean().optional(),
  maxIdentityDrift: z.number().min(0).max(1),
  lockHairState: z.boolean().optional(),
  lockWardrobe: z.boolean().optional(),
});
export type IdentityConstraints = z.infer<typeof IdentityConstraintsSchema>;

// ── Continuity Constraints (deferred until SP10) ──

export const ContinuityConstraintsSchema = z.object({
  useFirstFrame: z.boolean().optional(),
  useLastFrame: z.boolean().optional(),
  allowExtension: z.boolean().optional(),
  allowMotionTransfer: z.boolean().optional(),
  shotChainId: z.string().optional(),
});
export type ContinuityConstraints = z.infer<typeof ContinuityConstraintsSchema>;

// ── QA Thresholds ──

export const QaThresholdsSchema = z.object({
  faceSimilarityMin: z.number().min(0).max(1),
  realismMin: z.number().min(0).max(1),
  ocrAccuracyMin: z.number().min(0).max(1).optional(),
  voiceSimilarityMin: z.number().min(0).max(1).optional(),
});
export type QaThresholds = z.infer<typeof QaThresholdsSchema>;

// ── Creative Spec ──

export const CreativeSpecSchema = z.object({
  specId: z.string(),
  deploymentId: z.string(),
  mode: z.literal("ugc"),
  creatorId: z.string(),
  structureId: z.string(),
  motivator: z.string(),
  platform: UgcPlatform,
  script: z.object({
    text: z.string(),
    language: z.string(),
    claimsPolicyTag: z.string().optional(),
  }),
  style: SceneStyleSchema,
  direction: UgcDirectionSchema,
  format: UgcFormat,
  identityConstraints: IdentityConstraintsSchema,
  continuityConstraints: ContinuityConstraintsSchema.optional(),
  renderTargets: z.object({
    aspect: z.enum(["9:16", "1:1", "4:5"]),
    durationSec: z.number(),
    fps: z.number().optional(),
    resolution: z.string().optional(),
  }),
  qaThresholds: QaThresholdsSchema,
  providersAllowed: z.array(z.string()),
  campaignTags: z.record(z.string()),
});
export type CreativeSpec = z.infer<typeof CreativeSpecSchema>;
