// packages/schemas/src/creator-identity.ts
import { z } from "zod";

export const VoiceSchema = z.object({
  voiceId: z.string(),
  provider: z.literal("elevenlabs"),
  tone: z.string(),
  pace: z.enum(["slow", "moderate", "fast"]),
  sampleUrl: z.string(),
  settings: z
    .object({
      stability: z.number().optional(),
      similarity: z.number().optional(),
      style: z.number().optional(),
    })
    .optional(),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const PersonalitySchema = z.object({
  energy: z.enum(["calm", "conversational", "energetic", "intense"]),
  deliveryStyle: z.string(),
  catchphrases: z.array(z.string()).optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
});
export type Personality = z.infer<typeof PersonalitySchema>;

export const AppearanceRulesSchema = z.object({
  hairStates: z.array(z.string()),
  wardrobePalette: z.array(z.string()),
  jewelryRules: z.array(z.string()).optional(),
  makeupRules: z.array(z.string()).optional(),
  forbiddenLooks: z.array(z.string()).optional(),
});
export type AppearanceRules = z.infer<typeof AppearanceRulesSchema>;

export const ImperfectionProfileSchema = z.object({
  hesitationDensity: z.number().min(0).max(1),
  sentenceRestartRate: z.number().min(0).max(1),
  microPauseDensity: z.number().min(0).max(1),
  fillerDensityTarget: z.number().min(0).max(0.5),
  fragmentationTarget: z.number().min(0).max(1),
});
export type ImperfectionProfile = z.infer<typeof ImperfectionProfileSchema>;

export const CreatorIdentitySchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  name: z.string(),
  identityRefIds: z.array(z.string()),
  heroImageAssetId: z.string(),
  identityDescription: z.string(),
  identityObjects: z.record(z.string()).nullable().optional(),
  voice: VoiceSchema,
  personality: PersonalitySchema,
  appearanceRules: AppearanceRulesSchema,
  environmentSet: z.array(z.string()),
  approved: z.boolean(),
  isActive: z.boolean(),
  bibleVersion: z.string(),
  previousVersionId: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CreatorIdentity = z.infer<typeof CreatorIdentitySchema>;
