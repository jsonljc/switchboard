import { z } from "zod";

export const ClaimTypeEnum = z.enum([
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
  "none",
]);

export type ClaimTypeLabel = z.infer<typeof ClaimTypeEnum>;

export const LanguageEnum = z.enum(["en", "zh", "ms"]);
export const JurisdictionEnum = z.enum(["SG", "MY"]);

export const FixtureRowSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  language: LanguageEnum,
  jurisdiction: JurisdictionEnum,
  expectedClaimType: ClaimTypeEnum,
  acceptableClaimTypes: z.array(ClaimTypeEnum).optional(),
  notes: z.string().optional(),
});

export type FixtureRow = z.infer<typeof FixtureRowSchema>;

export const PerClaimTypeMetricSchema = z.object({
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
});

export const BaselineSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  classifierPromptHash: z.string().min(1),
  classifierPromptVersion: z.string().min(1),
  totalFixtures: z.number().int().nonnegative(),
  overallAccuracy: z.number().min(0).max(1),
  perClaimTypeAccuracy: z.record(ClaimTypeEnum, PerClaimTypeMetricSchema),
  toleranceBps: z.number().int().nonnegative(),
});

export type Baseline = z.infer<typeof BaselineSchema>;
