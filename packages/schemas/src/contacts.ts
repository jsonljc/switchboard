import { z } from "zod";
import {
  ContactStageSchema,
  OpportunityStageSchema,
  RevenueTypeSchema,
  RevenueStatusSchema,
} from "./lifecycle.js";

// ---------------------------------------------------------------------------
// Page-ready row shape — surface-agnostic projection used by /contacts.
// The dashboard never sees raw Prisma `Contact`; it sees this.
// ---------------------------------------------------------------------------

export const ContactBrowseRowSchema = z.object({
  id: z.string(),
  // displayName resolution: name → phone → email → "—". Resolved server-side.
  displayName: z.string(),
  stage: ContactStageSchema,
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
  source: z.string().nullable(),
  lastActivityAt: z.string().datetime(),
  firstContactAt: z.string().datetime(),
  // Non-terminal opportunities for this contact, capped at 99 in the projection.
  opportunityCount: z.number().int().min(0).max(99),
  // Reserved for D1.5; the API emits it so the detail link can pre-warm.
  detailHref: z.string(),
});
export type ContactBrowseRow = z.infer<typeof ContactBrowseRowSchema>;

// ---------------------------------------------------------------------------
// Query — validated at the Fastify boundary; the cursor is opaque base64.
// ---------------------------------------------------------------------------

export const ContactsListQuerySchema = z.object({
  stage: ContactStageSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  // Opaque base64 — opaque to the dashboard, decoded server-side. .min(1)
  // matches the search precedent (rejects empty `?cursor=`); .max(512) is a
  // generous ceiling on the encoded `{ts: ISO, id}` payload to short-circuit
  // unbounded input before Buffer.from allocates.
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.enum(["lastActivityAt", "firstContactAt"]).default("lastActivityAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
export type ContactsListQuery = z.infer<typeof ContactsListQuerySchema>;

// ---------------------------------------------------------------------------
// Response — `hasMore` is truthful (driven by limit+1 fetch); `nextCursor`
// is null on the final page. No total count: a second COUNT(*) query isn't
// worth the cost in v1 — the UI shows "Showing 1–N · more →", not pages.
// ---------------------------------------------------------------------------

export const ContactsListResponseSchema = z.object({
  rows: z.array(ContactBrowseRowSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type ContactsListResponse = z.infer<typeof ContactsListResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// D1.5: /contacts/[id] detail page composite payload
// ─────────────────────────────────────────────────────────────────────────────

export const ContactDetailProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  primaryChannel: z.enum(["whatsapp", "telegram", "dashboard"]),
  stage: ContactStageSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.string().nullable(),
  sourceType: z.string().nullable(),
  attributionSummary: z.string().nullable(),
  messagingConsent: z.object({
    optedIn: z.boolean(),
    optedInAt: z.string().datetime().nullable(),
    source: z.string().nullable(),
    optedOutAt: z.string().datetime().nullable(),
  }),
  firstContactAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
});
export type ContactDetailProfile = z.infer<typeof ContactDetailProfileSchema>;

export const ContactDetailOpportunitySchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  stage: OpportunityStageSchema,
  estimatedValue: z.number().int().nullable(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});
export type ContactDetailOpportunity = z.infer<typeof ContactDetailOpportunitySchema>;

export const ContactDetailThreadSchema = z.object({
  id: z.string(),
  assignedAgent: z.string(),
  summary: z.string(),
  lastMessageAt: z.string().datetime().nullable(),
});
export type ContactDetailThread = z.infer<typeof ContactDetailThreadSchema>;

export const ContactDetailOpenDecisionSchema = z.object({
  id: z.string(),
  kind: z.enum(["approval", "handoff"]),
  agentKey: z.string().nullable(),
  title: z.string(),
  createdAt: z.string().datetime(),
});
export type ContactDetailOpenDecision = z.infer<typeof ContactDetailOpenDecisionSchema>;

export const ContactDetailRevenueEventSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  currency: z.string().length(3),
  type: RevenueTypeSchema,
  status: RevenueStatusSchema,
  recordedAt: z.string().datetime(),
});
export type ContactDetailRevenueEvent = z.infer<typeof ContactDetailRevenueEventSchema>;

export const ContactDetailResponseSchema = z.object({
  profile: ContactDetailProfileSchema,
  opportunities: z.array(ContactDetailOpportunitySchema),
  threads: z.array(ContactDetailThreadSchema),
  openDecisions: z.array(ContactDetailOpenDecisionSchema),
  revenueEvents: z.array(ContactDetailRevenueEventSchema),
});
export type ContactDetailResponse = z.infer<typeof ContactDetailResponseSchema>;
