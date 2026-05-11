import { z } from "zod";

/**
 * Frontmatter contract for `skills/<agent>/references/*` files.
 * Consumed by the skill loader (Phase 1a Task 5) and the
 * `pnpm reference-audit` script (Phase 1a Task 8).
 */
export const ReferenceMetadataSchema = z.object({
  jurisdiction: z.enum(["SG", "MY", "both", "none"]),
  vertical: z.enum(["medspa", "dental", "fitness", "generic", "none"]),
  clinicType: z.enum(["medical", "nonMedical", "both", "none"]),
  appliesTo: z.enum(["voice", "regulatory", "pattern", "channel"]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  lastReviewedAt: z.string().date(),
  owner: z.string().min(1),
  sources: z.array(z.string().url()).optional(),
});

export type ReferenceMetadata = z.infer<typeof ReferenceMetadataSchema>;
