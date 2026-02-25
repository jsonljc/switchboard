import { z } from "zod";
import { RiskScoreSchema } from "./risk.js";
import { ApprovalRequirementSchema } from "./identity-spec.js";

export const CheckCodeSchema = z.enum([
  "FORBIDDEN_BEHAVIOR",
  "TRUST_BEHAVIOR",
  "RATE_LIMIT",
  "COOLDOWN",
  "PROTECTED_ENTITY",
  "SPEND_LIMIT",
  "POLICY_RULE",
  "RISK_SCORING",
  "RESOLVER_AMBIGUITY",
  "COMPETENCE_TRUST",
  "COMPETENCE_ESCALATION",
  "COMPOSITE_RISK",
  "DELEGATION_CHAIN",
  "SYSTEM_POSTURE",
]);
export type CheckCode = z.infer<typeof CheckCodeSchema>;

export const CheckEffectSchema = z.enum(["allow", "deny", "modify", "skip", "escalate"]);
export type CheckEffect = z.infer<typeof CheckEffectSchema>;

export const DecisionCheckSchema = z.object({
  checkCode: CheckCodeSchema,
  checkData: z.record(z.string(), z.unknown()),
  humanDetail: z.string(),
  matched: z.boolean(),
  effect: CheckEffectSchema,
});
export type DecisionCheck = z.infer<typeof DecisionCheckSchema>;

export const FinalDecisionSchema = z.enum(["allow", "deny", "modify"]);
export type FinalDecision = z.infer<typeof FinalDecisionSchema>;

export const DecisionTraceSchema = z.object({
  actionId: z.string(),
  envelopeId: z.string(),
  checks: z.array(DecisionCheckSchema),
  computedRiskScore: RiskScoreSchema,
  finalDecision: FinalDecisionSchema,
  approvalRequired: ApprovalRequirementSchema,
  explanation: z.string(),
  evaluatedAt: z.coerce.date(),
});
export type DecisionTrace = z.infer<typeof DecisionTraceSchema>;
