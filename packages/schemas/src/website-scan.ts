import { z } from "zod";

export const ScanRequestSchema = z.object({
  url: z.string().url(),
  sourceType: z.enum(["website", "instagram", "google_business", "facebook"]).default("website"),
});
export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const ScanConfidence = z.enum(["high", "medium", "low"]);
export type ScanConfidence = z.infer<typeof ScanConfidence>;

export const ScanResultSchema = z.object({
  businessName: z.object({ value: z.string(), confidence: ScanConfidence }).optional(),
  category: z.object({ value: z.string(), confidence: ScanConfidence }).optional(),
  location: z.object({ value: z.string(), confidence: ScanConfidence }).optional(),
  services: z
    .array(
      z.object({
        name: z.string(),
        price: z.number().optional(),
        duration: z.number().optional(),
        confidence: ScanConfidence,
      }),
    )
    .default([]),
  hours: z.record(z.string()).optional(),
  contactMethods: z.array(z.string()).default([]),
  faqHints: z.array(z.string()).default([]),
});
export type ScanResult = z.infer<typeof ScanResultSchema>;
