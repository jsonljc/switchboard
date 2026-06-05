import { z } from "zod";

/**
 * Mira slice-4 brain compose contract (spec 3.6,
 * docs/superpowers/specs/2026-06-05-mira-slice4-brain-design.md).
 *
 * The request field is deliberately named composeSource, NOT trigger: the
 * canonical ingress request already carries a `trigger` ("schedule"/"internal")
 * and overloading the word at the same call site invites wiring the wrong one.
 */
export const MiraComposeSourceSchema = z.enum(["weekly_scan", "riley_handoff"]);
export type MiraComposeSource = z.infer<typeof MiraComposeSourceSchema>;

export const MiraComposeRecommendationSchema = z.object({
  actionType: z.string().min(1),
  campaignId: z.string().min(1),
  rationale: z.string().min(1).max(2000),
  evidence: z.object({
    clicks: z.number(),
    conversions: z.number(),
    days: z.number(),
  }),
});
export type MiraComposeRecommendation = z.infer<typeof MiraComposeRecommendationSchema>;

export const MiraComposeRequestSchema = z
  .object({
    composeSource: MiraComposeSourceSchema,
    recommendation: MiraComposeRecommendationSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.composeSource === "riley_handoff" && !v.recommendation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "composeSource riley_handoff requires a recommendation context",
        path: ["recommendation"],
      });
    }
  });
export type MiraComposeRequest = z.infer<typeof MiraComposeRequestSchema>;

/**
 * A constrained subset of the frozen CreativeConceptDraftInput seam (tighter
 * length caps, no valueContext) so the draft submit is a clean passthrough.
 */
export const MiraComposeBriefSchema = z.object({
  productDescription: z.string().min(1).max(500),
  targetAudience: z.string().min(1).max(500),
});
export type MiraComposeBrief = z.infer<typeof MiraComposeBriefSchema>;

export const MiraComposeOutputSchema = z
  .object({
    decision: z.enum(["propose", "abstain"]),
    reason: z.string().min(1).max(500),
    brief: MiraComposeBriefSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "propose" && !v.brief) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "decision propose requires a brief",
        path: ["brief"],
      });
    }
  });
export type MiraComposeOutput = z.infer<typeof MiraComposeOutputSchema>;

export type ParsedMiraComposeOutput =
  | { ok: true; value: MiraComposeOutput }
  | { ok: false; error: string };

const LEADING_FENCE = /^```(?:json)?\s*\n?/;
const TRAILING_FENCE = /\n?```\s*$/;

/**
 * Fence-stripping, zod-validating parser for the brain's raw response text.
 * Any failure means ABSTAIN at the caller: a malformed compose can only ever
 * cost a skipped run, never fabricate a draft (spec 3.6).
 */
export function parseMiraComposeOutput(text: string): ParsedMiraComposeOutput {
  const unfenced = text.trim().replace(LEADING_FENCE, "").replace(TRAILING_FENCE, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(unfenced);
  } catch (err) {
    return {
      ok: false,
      error: `not JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const parsed = MiraComposeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `schema: ${parsed.error.message}` };
  }
  return { ok: true, value: parsed.data };
}
