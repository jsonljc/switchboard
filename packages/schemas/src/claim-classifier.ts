import { z } from "zod";

export const ClaimTypeSchema = z.enum([
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

export type ClaimType = z.infer<typeof ClaimTypeSchema>;

export const ClassifierSentenceResultSchema = z.object({
  sentence: z.string(),
  claimType: ClaimTypeSchema,
  confidence: z.number().min(0).max(1),
});

export type ClassifierSentenceResult = z.infer<typeof ClassifierSentenceResultSchema>;

export const CLASSIFIER_SCHEMA_VERSION = "1.0.0" as const;
