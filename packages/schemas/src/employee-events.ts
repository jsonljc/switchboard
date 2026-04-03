// ---------------------------------------------------------------------------
// Employee Event Constants — per-employee event type registries
// ---------------------------------------------------------------------------

export const CREATIVE_EVENTS = {
  CONTENT_REQUESTED: "content.requested",
  CONTENT_DRAFT_READY: "content.draft_ready",
  CONTENT_APPROVED: "content.approved",
  CONTENT_REJECTED: "content.rejected",
  CONTENT_PUBLISHED: "content.published",
  CONTENT_FEEDBACK_RECEIVED: "content.feedback_received",
  CONTENT_PERFORMANCE_UPDATED: "content.performance_updated",
  CONTENT_CALENDAR_UPDATED: "content.calendar_updated",
  EMPLOYEE_ONBOARDED: "employee.onboarded",
} as const;

export type CreativeEventType = (typeof CREATIVE_EVENTS)[keyof typeof CREATIVE_EVENTS];
