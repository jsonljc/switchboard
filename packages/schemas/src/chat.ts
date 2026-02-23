import { z } from "zod";

export const ChannelSchema = z.enum(["telegram", "slack", "whatsapp", "email", "api"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const AttachmentSchema = z.object({
  type: z.string(),
  url: z.string().nullable(),
  data: z.unknown().nullable(),
  filename: z.string().nullable(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const IncomingMessageSchema = z.object({
  id: z.string(),
  channel: ChannelSchema,
  channelMessageId: z.string(),
  threadId: z.string().nullable(),
  principalId: z.string(),
  organizationId: z.string().nullable(),
  text: z.string(),
  attachments: z.array(AttachmentSchema),
  timestamp: z.coerce.date(),
});
export type IncomingMessage = z.infer<typeof IncomingMessageSchema>;

export const ConversationStatusSchema = z.enum([
  "active",
  "awaiting_clarification",
  "awaiting_approval",
  "completed",
  "expired",
]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const ConversationStateSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  channel: z.string(),
  principalId: z.string(),
  status: ConversationStatusSchema,
  currentIntent: z.string().nullable(),
  pendingProposalIds: z.array(z.string()),
  pendingApprovalIds: z.array(z.string()),
  clarificationQuestion: z.string().nullable(),
  lastActivityAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const ActionProposalSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
  originatingMessageId: z.string(),
  interpreterName: z.string().nullable().optional(),
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const ApprovalButtonSchema = z.object({
  label: z.string(),
  action: z.enum(["approve", "reject", "patch"]),
  patchValue: z.record(z.string(), z.unknown()).optional(),
});
export type ApprovalButton = z.infer<typeof ApprovalButtonSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string(),
  actionId: z.string(),
  envelopeId: z.string(),
  conversationId: z.string().nullable(),
  summary: z.string(),
  riskCategory: z.string(),
  bindingHash: z.string(),
  evidenceBundle: z.object({
    decisionTrace: z.unknown(),
    contextSnapshot: z.record(z.string(), z.unknown()),
    identitySnapshot: z.record(z.string(), z.unknown()),
  }),
  suggestedButtons: z.array(ApprovalButtonSchema),
  approvers: z.array(z.string()),
  fallbackApprover: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected", "expired", "patched"]),
  respondedBy: z.string().nullable(),
  respondedAt: z.coerce.date().nullable(),
  patchValue: z.record(z.string(), z.unknown()).nullable(),
  expiresAt: z.coerce.date(),
  expiredBehavior: z.enum(["deny", "re_request"]),
  createdAt: z.coerce.date(),
  quorum: z.object({
    required: z.number().int().min(1),
    approvalHashes: z.array(z.object({
      approverId: z.string(),
      hash: z.string(),
      approvedAt: z.coerce.date(),
    })),
  }).nullable().default(null),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ExecutionResultSchema = z.object({
  actionId: z.string(),
  envelopeId: z.string(),
  success: z.boolean(),
  summary: z.string(),
  externalRefs: z.record(z.string(), z.string()),
  rollbackAvailable: z.boolean(),
  partialFailures: z.array(
    z.object({
      step: z.string(),
      error: z.string(),
    }),
  ),
  durationMs: z.number(),
  undoRecipe: z.unknown().nullable(),
  executedAt: z.coerce.date(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
