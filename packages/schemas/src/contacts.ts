import { z } from "zod";
import { ContactStageSchema } from "./lifecycle.js";

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
  lastActivityAt: z.string(),
  firstContactAt: z.string(),
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
  cursor: z.string().optional(),
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
