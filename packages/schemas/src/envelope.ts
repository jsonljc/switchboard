import { z } from "zod";
import { ActionProposalSchema, ApprovalRequestSchema, ExecutionResultSchema } from "./chat.js";
import { DecisionTraceSchema } from "./decision-trace.js";
import { ResolvedEntitySchema } from "./resolver.js";
import { ActionPlanSchema } from "./action-plan.js";

export const EnvelopeStatusSchema = z.enum([
  "interpreting",
  "resolving",
  "proposed",
  "evaluating",
  "pending_approval",
  "approved",
  "queued",
  "executing",
  "executed",
  "failed",
  "denied",
  "expired",
]);
export type EnvelopeStatus = z.infer<typeof EnvelopeStatusSchema>;

export const ActionEnvelopeSchema = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(),

  // Origin
  incomingMessage: z.unknown().nullable(),
  conversationId: z.string().nullable(),

  // Interpretation
  proposals: z.array(ActionProposalSchema),
  resolvedEntities: z.array(ResolvedEntitySchema),

  // Governance
  plan: ActionPlanSchema.nullable(),
  decisions: z.array(DecisionTraceSchema),

  // Approval
  approvalRequests: z.array(ApprovalRequestSchema),

  // Execution
  executionResults: z.array(ExecutionResultSchema),

  // Audit
  auditEntryIds: z.array(z.string()),

  // Lifecycle
  status: EnvelopeStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),

  // Traceability
  parentEnvelopeId: z.string().nullable(),
  traceId: z.string().nullable(),
});
export type ActionEnvelope = z.infer<typeof ActionEnvelopeSchema>;
