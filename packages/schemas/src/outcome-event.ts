// ---------------------------------------------------------------------------
// Outcome Event Schema — conversation outcome tracking
// ---------------------------------------------------------------------------

import { z } from "zod";

export const OutcomeTypeSchema = z.enum([
  "booked",
  "escalated_resolved",
  "escalated_unresolved",
  "unresponsive",
  "lost",
  "reactivated",
]);
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>;

export const OutcomeEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  organizationId: z.string().min(1),
  leadId: z.string().optional(),
  outcomeType: OutcomeTypeSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.date(),
});
export type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;

export const ResponseVariantLogSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  organizationId: z.string().min(1),
  primaryMove: z.string().min(1),
  templateId: z.string().optional(),
  responseText: z.string().min(1),
  leadReplyReceived: z.boolean().optional(),
  leadReplyPositive: z.boolean().optional(),
  conversationState: z.string().optional(),
  timestamp: z.date(),
});
export type ResponseVariantLog = z.infer<typeof ResponseVariantLogSchema>;
