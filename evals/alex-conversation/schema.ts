import { z } from "zod";
import { ConversationOracleSchema } from "./oracle.js";

/**
 * Funnel/agent stage a scenario primarily exercises. Optional — used by the
 * matrix-coverage test to assert the suite spans the funnel. `full-arc` is a
 * single multi-turn fixture walking discovery → objection → qualification →
 * booking.
 */
export const ConversationStageSchema = z.enum([
  "discovery",
  "objection",
  "qualification",
  "booking",
  "post-booking",
  "safety",
  "refusal",
  "reactivation",
  "full-arc",
]);
export type ConversationStage = z.infer<typeof ConversationStageSchema>;

export const LeadTurnSchema = z.object({ role: z.literal("lead"), content: z.string().min(1) });
export const GradeSpecSchema = z.object({
  mustAsk: z.array(z.string()).default([]),
  mustDo: z.array(z.string()).default([]),
  mustNot: z.array(z.string()).default([]),
  shouldDo: z.array(z.string()).default([]),
});
export const AlexTurnSchema = z.object({ role: z.literal("alex"), grade: GradeSpecSchema });

export const ConversationFixtureSchema = z
  .object({
    id: z.string().min(1),
    vertical: z.literal("medspa"),
    locale: z.enum(["sg", "my"]),
    scenario: z.string().min(1),
    /**
     * Which BusinessFacts state to drive the (real) store with for this fixture.
     * "operator" (default) = operator-approved facts present; "absent" = no
     * BusinessConfig row → BUSINESS_FACTS renders empty → Alex must escalate, not
     * fabricate. See run-conversation.ts resolveParameters.
     */
    businessFacts: z.enum(["operator", "absent"]).default("operator"),
    /**
     * Optional per-fixture mock-booking behavior for `calendar-book.booking.create`.
     * Absent (default) = the mock books successfully; "pending" = the create parks
     * for human approval (status:"pending_approval"); "slot_taken" = the create
     * returns a retryable SLOT_TAKEN failure (overlap). Drives the offline
     * duplicate/slot-taken + governed-close fixtures. See mock-tools.ts createMockTools.
     */
    mockBooking: z.enum(["success", "pending", "slot_taken"]).optional(),
    /**
     * Optional per-fixture slots.query behavior. Omitted / "available" (default) =
     * two open slots; "empty" = no slots, exercising the after-hours path (Alex must
     * offer a wider window, NOT claim the system is down or escalate). See
     * mock-tools.ts createMockTools + run-conversation.ts.
     */
    mockSlots: z.enum(["available", "empty"]).optional(),
    /**
     * D3-1: which onboarding-playbook state to drive Alex's BOOKABLE_SERVICES with.
     * Omitted (default) and "absent" both mean no playbook → BOOKABLE_SERVICES renders
     * "" (free-text fallback, resolver abstains). "operator" = a priced canonical medspa
     * playbook is wired so Alex can book using the exact bookable-service name. Optional
     * (not .default) so the inferred type stays back-compatible with the many existing
     * fixtures that omit it. See run-conversation.ts resolveParameters (treats undefined
     * as absent) + stub-context-store.ts createStubPlaybook.
     */
    playbook: z.enum(["operator", "absent"]).optional(),
    turns: z.array(z.union([LeadTurnSchema, AlexTurnSchema])).min(2),
    /** Optional funnel/agent stage (matrix coverage). Backward compatible. */
    stage: ConversationStageSchema.optional(),
    /** Optional free-form tags (concern axes, edge dimensions). */
    tags: z.array(z.string()).optional(),
    /** Optional machine-checkable trajectory oracle (see oracle.ts). */
    oracle: ConversationOracleSchema.optional(),
  })
  .refine((f) => f.turns[f.turns.length - 1]?.role === "alex", "fixture must end on an alex turn")
  .refine((f) => f.turns[0]?.role === "lead", "fixture must start on a lead turn");
export type ConversationFixture = z.infer<typeof ConversationFixtureSchema>;

export const ClaimWarningSchema = z.object({
  claimType: z.string(),
  confidence: z.number(),
  sentence: z.string(),
});

export const ScenarioBaselineSchema = z.object({
  id: z.string(),
  deterministicPass: z.boolean(),
  judgeScore: z.number().min(0).max(5),
  requiredBehaviorsMet: z.array(z.string()),
  violations: z.array(z.string()),
  /**
   * Advisory claim warnings from the per-sentence classifier. Informational
   * only — stored in the baseline for observability, but never gate regression.
   */
  claimWarnings: z.array(ClaimWarningSchema).optional(),
});
export const BaselineSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  skillContentHash: z.string().min(1),
  judgeRubricVersion: z.string().min(1),
  judgeScoreTolerance: z.number().min(0).max(5),
  scenarios: z.array(ScenarioBaselineSchema),
});
export type Baseline = z.infer<typeof BaselineSchema>;
