import { z } from "zod";
import { RiskCategorySchema } from "./risk.js";
import { ApprovalRequirementSchema } from "./identity-spec.js";

export const ActionStatusSchema = z.enum([
  "proposed", "enriching", "evaluating",
  "pending_approval", "approved", "queued",
  "executing", "executed", "failed",
  "denied", "expired", "cancelled",
]);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

export const ActionSchema = z.object({
  id: z.string(),
  envelopeId: z.string(),
  actionType: z.string(),
  cartridgeId: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  effectiveParameters: z.record(z.string(), z.unknown()),
  status: ActionStatusSchema,
  riskCategory: RiskCategorySchema,
  approvalRequirement: ApprovalRequirementSchema,
  principalId: z.string(),
  organizationId: z.string().nullable(),
  idempotencyKey: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Action = z.infer<typeof ActionSchema>;
