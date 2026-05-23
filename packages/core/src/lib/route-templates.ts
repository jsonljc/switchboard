/**
 * Surface-URL emission contract injected into core projections so that
 * `packages/core/**` never contains a literal route URL. The constant lives
 * in `apps/api/src/lib/route-templates.ts`; chat and dashboard apps that
 * later need their own URLs construct their own constants.
 *
 * Route Governance Contract v1 §8.5 (surface-URL strings in core).
 */
export interface RouteTemplates {
  /** `/contacts/<id>` — the contact detail page. */
  contactDetail(id: string): string;
  /** `/contacts/<id>/conversations` — the contact's thread list. */
  contactConversations(id: string): string;
  /** `/contacts/<id>/conversations/<threadId>` — a single thread within the contact. */
  contactConversationDetail(id: string, threadId: string): string;
}
