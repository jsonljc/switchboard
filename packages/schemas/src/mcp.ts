import { z } from "zod";

// ── Side-Effect Tool Inputs ────────────────────────────────────────────────

export const PauseCampaignInputSchema = z.object({
  campaignId: z.string().min(1),
  reason: z.string().optional(),
});
export type PauseCampaignInput = z.infer<typeof PauseCampaignInputSchema>;

export const ResumeCampaignInputSchema = z.object({
  campaignId: z.string().min(1),
});
export type ResumeCampaignInput = z.infer<typeof ResumeCampaignInputSchema>;

export const AdjustBudgetInputSchema = z.object({
  campaignId: z.string().min(1),
  newBudget: z.number().positive(),
  currency: z.string().optional(),
});
export type AdjustBudgetInput = z.infer<typeof AdjustBudgetInputSchema>;

export const ModifyTargetingInputSchema = z.object({
  adSetId: z.string().min(1),
  targeting: z.record(z.string(), z.unknown()),
});
export type ModifyTargetingInput = z.infer<typeof ModifyTargetingInputSchema>;

// ── Read-Only Tool Inputs ──────────────────────────────────────────────────

export const GetCampaignInputSchema = z.object({
  campaignId: z.string().min(1),
});
export type GetCampaignInput = z.infer<typeof GetCampaignInputSchema>;

export const SearchCampaignsInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
});
export type SearchCampaignsInput = z.infer<typeof SearchCampaignsInputSchema>;

export const SimulateActionInputSchema = z.object({
  actionType: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()),
});
export type SimulateActionInput = z.infer<typeof SimulateActionInputSchema>;

export const GetApprovalStatusInputSchema = z.object({
  approvalId: z.string().min(1),
});
export type GetApprovalStatusInput = z.infer<typeof GetApprovalStatusInputSchema>;

export const ListPendingApprovalsInputSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
});
export type ListPendingApprovalsInput = z.infer<typeof ListPendingApprovalsInputSchema>;

export const GetActionStatusInputSchema = z.object({
  envelopeId: z.string().min(1),
});
export type GetActionStatusInput = z.infer<typeof GetActionStatusInputSchema>;

// ── Governance Tool Inputs ────────────────────────────────────────────────

export const RequestUndoInputSchema = z.object({
  envelopeId: z.string().min(1),
});
export type RequestUndoInput = z.infer<typeof RequestUndoInputSchema>;

export const EmergencyHaltInputSchema = z.object({
  reason: z.string().optional(),
});
export type EmergencyHaltInput = z.infer<typeof EmergencyHaltInputSchema>;

export const GetAuditTrailInputSchema = z.object({
  envelopeId: z.string().optional(),
  entityId: z.string().optional(),
  eventType: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
});
export type GetAuditTrailInput = z.infer<typeof GetAuditTrailInputSchema>;

export const GetGovernanceStatusInputSchema = z.object({
  organizationId: z.string().optional(),
});
export type GetGovernanceStatusInput = z.infer<typeof GetGovernanceStatusInputSchema>;

// ── Result Schemas ─────────────────────────────────────────────────────────

export const McpExecuteResultSchema = z.object({
  outcome: z.enum(["EXECUTED", "PENDING_APPROVAL", "DENIED"]),
  envelopeId: z.string(),
  traceId: z.string(),
  summary: z.string().optional(),
  approvalId: z.string().optional(),
  deniedExplanation: z.string().optional(),
  governanceNote: z.string().optional(),
});
export type McpExecuteResult = z.infer<typeof McpExecuteResultSchema>;

export const McpReadResultSchema = z.object({
  data: z.unknown(),
  traceId: z.string(),
});
export type McpReadResult = z.infer<typeof McpReadResultSchema>;
