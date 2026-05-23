import type { RouteTemplates } from "@switchboard/core";

/**
 * The dashboard's URL shape, injected into core projections at the API
 * boundary. This is the single source of truth for `/contacts/...` URLs
 * emitted by `listContactsForBrowse`, `adaptRecommendation`, and
 * `adaptHandoff`.
 *
 * If the dashboard renames `/contacts` → `/people` (etc.), update this
 * constant; core does not need to change.
 *
 * Route Governance Contract v1 §8.5.
 */
export const dashboardRouteTemplates: RouteTemplates = {
  contactDetail: (id) => `/contacts/${id}`,
  contactConversations: (id) => `/contacts/${id}/conversations`,
  contactConversationDetail: (id, threadId) => `/contacts/${id}/conversations/${threadId}`,
};
