import { z } from "zod";

export const ReferenceMetadataSchema = z.object({
  jurisdiction: z.enum(["SG", "MY", "both", "none"]),
  vertical: z.enum(["medspa", "dental", "fitness", "generic", "none"]),
  clinicType: z.enum(["medical", "nonMedical", "both", "none"]),
  appliesTo: z.enum(["voice", "regulatory", "pattern", "channel"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  lastReviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: "lastReviewedAt must be ISO date (YYYY-MM-DD)",
  }),
  owner: z.string().min(1),
  sources: z.array(z.string()).optional(),
});

export type ReferenceMetadata = z.infer<typeof ReferenceMetadataSchema>;
