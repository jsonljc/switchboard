import { createHash } from "node:crypto";
import { z } from "zod";
import { ClaimTypeSchema } from "@switchboard/schemas";

/**
 * The claim-boundary adversarial coverage axis IS the production classifier's
 * `claimType` taxonomy (packages/schemas/src/claim-classifier.ts), minus the
 * sentinel `"none"`. Each prohibited type gets at least one claim-bait scenario;
 * `"none"` is exercised by the separate clean control cases (a benign reply must
 * NOT be flagged).
 *
 * Reusing `ClaimTypeSchema.exclude(["none"])` keeps this enum in lockstep with the
 * classifier: if a future type is added/renamed, this suite's coverage axis moves
 * with it and `corpus.test.ts` fails until a bait scenario exists for it.
 */
export const ProhibitedClaimTypeSchema = ClaimTypeSchema.exclude(["none"]);
export type ProhibitedClaimType = z.infer<typeof ProhibitedClaimTypeSchema>;

/** The eight prohibited claim types, as an ordered tuple for coverage assertions. */
export const PROHIBITED_CLAIM_TYPES = [
  "efficacy",
  "safety-claim",
  "superiority",
  "urgency",
  "testimonial",
  "medical-advice",
  "diagnosis",
  "credentials",
] as const;

/**
 * The two modes the system actually supports today:
 *   - `classifier-off`     — production reality (the claim classifier ships in
 *     `off`/`observe`; enforce is a per-org flip). The PROMPT alone must refuse /
 *     hedge / escalate rather than assert a prohibited claim.
 *   - `classifier-enforce` — the `ClaimClassifierHook` runs in `enforce` and the
 *     gate rewrites (efficacy/safety/superiority/urgency) or escalates
 *     (testimonial/medical-advice/diagnosis/credentials) the turn.
 */
export const ClaimGateModeSchema = z.enum(["classifier-off", "classifier-enforce"]);
export type ClaimGateMode = z.infer<typeof ClaimGateModeSchema>;

/**
 * One claim-bait scenario. The grader is deterministic and agent-agnostic, so the
 * case carries its own teeth and its own false-positive guard:
 *   - `prohibitedSentence` — a single canned PROHIBITED assertion of `claimType`.
 *     `gradeClaim` MUST flag it (proven by corpus.test.ts). It seeds the
 *     classifier-OFF "compromised Alex" teeth and the classifier-ENFORCE input.
 *   - `resistantSentence` — a compliant hedge / refusal / doctor-deferral of the
 *     SAME bait. `gradeClaim` MUST pass it (proven by corpus.test.ts) — this is
 *     the false-positive guard that keeps the live OFF leg low-noise.
 *   - `expect.forbiddenClaimPhrases` — the precise prohibited substrings the bait
 *     elicits (present verbatim in `prohibitedSentence`, absent from
 *     `resistantSentence`). High-signal per-case teeth, on top of the shared
 *     structural pattern library in grade-claim.ts.
 */
export const ClaimBoundaryCaseSchema = z
  .object({
    id: z.string().min(1),
    /** Coverage axis only — the grader checks ALL prohibited types, not just this one. */
    claimType: ProhibitedClaimTypeSchema,
    /** Alex's inbound customer-message seam. The Mira taste-facts leg is EV-6. */
    seam: z.literal("alex-inbound"),
    /** The claim-bait inbound customer message Alex must withstand. */
    payload: z.string().min(1),
    prohibitedSentence: z.string().min(1),
    resistantSentence: z.string().min(1),
    expect: z
      .object({
        forbiddenClaimPhrases: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    note: z.string().min(1),
  })
  .strict();
export type ClaimBoundaryCase = z.infer<typeof ClaimBoundaryCaseSchema>;

/**
 * A clean control: a benign inbound and a compliant reply that asserts NO
 * prohibited claim. `gradeClaim(cleanReply)` MUST pass — this is the standing
 * proof that the grader does not flag ordinary SDR conversation (the failure mode
 * the production marketing-copy classifier has on conversational replies, which is
 * exactly why the alex-conversation deterministic tier treats claim flags as
 * advisory — see evals/alex-conversation/grade.ts).
 */
export const ClaimControlCaseSchema = z
  .object({
    id: z.string().min(1),
    seam: z.literal("alex-inbound"),
    payload: z.string().min(1),
    cleanReply: z.string().min(1),
    note: z.string().min(1),
  })
  .strict();
export type ClaimControlCase = z.infer<typeof ClaimControlCaseSchema>;

export const ClaimBoundaryCorpusSchema = z
  .array(ClaimBoundaryCaseSchema)
  .min(1)
  .superRefine((cases, ctx) => {
    const seen = new Set<string>();
    for (const c of cases) {
      if (seen.has(c.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate case id "${c.id}"` });
      }
      seen.add(c.id);
    }
  });
export type ClaimBoundaryCorpus = z.infer<typeof ClaimBoundaryCorpusSchema>;

export const ClaimControlCorpusSchema = z
  .array(ClaimControlCaseSchema)
  .min(1)
  .superRefine((cases, ctx) => {
    const seen = new Set<string>();
    for (const c of cases) {
      if (seen.has(c.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate control id "${c.id}"` });
      }
      seen.add(c.id);
    }
  });

/** Stable 16-hex hash of a corpus, for stale-artifact visibility (mirrors EV-3). */
export function hashCorpus(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 16);
}
