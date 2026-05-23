import { z } from "zod";

/**
 * Wire-format message entry used by the api `conversations.ts` route's
 * projection schemas. Distinct from `ConversationMessage` in `./chat.ts`,
 * which uses `Date` (the runtime shape); here we use ISO strings because
 * the projections cross the HTTP boundary and are JSON-serialized.
 */
export const ConversationMessageEntrySchema = z.object({
  role: z.string(),
  text: z.string(),
  timestamp: z.string().datetime(),
});
export type ConversationMessageEntry = z.infer<typeof ConversationMessageEntrySchema>;

/**
 * Summary projection of ConversationState — what `/api/conversations` returns
 * in its list response. `messages` is collapsed to count + preview, dates are
 * ISO strings (RFC 3339 / Zod's `.datetime()`).
 */
export const ConversationSummarySchema = z.object({
  id: z.string(),
  threadId: z.string(),
  channel: z.string(),
  principalId: z.string(),
  organizationId: z.string().nullable(),
  status: z.string(),
  currentIntent: z.string().nullable(),
  messageCount: z.number().int().min(0),
  lastMessage: z.string().nullable(),
  firstReplyAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime(),
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

/**
 * Detail projection of ConversationState — what `/api/conversations/:id`
 * returns. Includes the message array in wire format.
 */
export const ConversationDetailSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  channel: z.string(),
  principalId: z.string(),
  organizationId: z.string().nullable(),
  status: z.string(),
  currentIntent: z.string().nullable(),
  firstReplyAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime(),
  messages: z.array(ConversationMessageEntrySchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

export const ConversationListResultSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
});
export type ConversationListResult = z.infer<typeof ConversationListResultSchema>;
