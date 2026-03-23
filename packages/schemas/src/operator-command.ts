import { z } from "zod";
import { RiskLevelSchema } from "./workflow.js";

// ---------------------------------------------------------------------------
// Operator Channel
// ---------------------------------------------------------------------------

export const OperatorChannelSchema = z.enum(["telegram", "whatsapp", "dashboard"]);
export type OperatorChannel = z.infer<typeof OperatorChannelSchema>;

// ---------------------------------------------------------------------------
// Command Status
// ---------------------------------------------------------------------------

export const CommandStatusSchema = z.enum([
  "parsed",
  "confirmed",
  "executing",
  "completed",
  "failed",
  "rejected",
]);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;

export const TERMINAL_COMMAND_STATUSES: CommandStatus[] = ["completed", "failed", "rejected"];

// ---------------------------------------------------------------------------
// Intent Catalog (narrow launch vocabulary)
// ---------------------------------------------------------------------------

export const CommandIntentSchema = z.string().min(1);
export type CommandIntent = z.infer<typeof CommandIntentSchema>;

export const LAUNCH_INTENTS = [
  "follow_up_leads",
  "pause_campaigns",
  "show_pipeline",
  "reassign_leads",
  "draft_campaign",
  "query_lead_history",
  "show_status",
  "resume_campaigns",
] as const;

// ---------------------------------------------------------------------------
// Command Entity (target of the command)
// ---------------------------------------------------------------------------

export const CommandEntitySchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  filter: z.record(z.unknown()).optional(),
});
export type CommandEntity = z.infer<typeof CommandEntitySchema>;

// ---------------------------------------------------------------------------
// Guardrail Result
// ---------------------------------------------------------------------------

export const GuardrailResultSchema = z.object({
  canExecute: z.boolean(),
  requiresConfirmation: z.boolean(),
  requiresPreview: z.boolean(),
  warnings: z.array(z.string()),
  missingEntities: z.array(z.string()),
  riskLevel: RiskLevelSchema,
  ambiguityFlags: z.array(z.string()),
});
export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;

// ---------------------------------------------------------------------------
// Operator Request (raw input)
// ---------------------------------------------------------------------------

export const OperatorRequestSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  operatorId: z.string(),
  channel: OperatorChannelSchema,
  rawInput: z.string(),
  receivedAt: z.coerce.date(),
});
export type OperatorRequest = z.infer<typeof OperatorRequestSchema>;

// ---------------------------------------------------------------------------
// Operator Command (parsed + evaluated)
// ---------------------------------------------------------------------------

export const OperatorCommandSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  organizationId: z.string(),
  intent: CommandIntentSchema,
  entities: z.array(CommandEntitySchema),
  parameters: z.record(z.unknown()),
  parseConfidence: z.number().min(0).max(1),
  guardrailResult: GuardrailResultSchema,
  status: CommandStatusSchema,
  workflowIds: z.array(z.string()),
  resultSummary: z.string().nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});
export type OperatorCommand = z.infer<typeof OperatorCommandSchema>;
