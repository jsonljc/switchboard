import type { AuditEventType } from "@switchboard/schemas";

/**
 * 4-band grouping of the 45 audit event types, matching the locked design's
 * combobox order. Insertion order is preserved when iterated.
 *
 * Source: docs/design-prompts/locked/switchboard/project/activity-v2/data.js
 * (the `eventTypes` object in `window.ACTIVITY_DATA`).
 */
export const EVENT_TYPE_BANDS: Readonly<Record<string, ReadonlyArray<AuditEventType>>> = {
  "Action lifecycle": [
    "action.proposed",
    "action.resolved",
    "action.enriched",
    "action.evaluated",
    "action.approved",
    "action.partially_approved",
    "action.rejected",
    "action.patched",
    "action.queued",
    "action.executing",
    "action.snapshot",
    "action.executed",
    "action.failed",
    "action.denied",
    "action.expired",
    "action.cancelled",
    "action.undo_requested",
    "action.undo_executed",
    "action.approval_expired",
  ],
  "Identity & governance": [
    "identity.created",
    "identity.updated",
    "overlay.activated",
    "overlay.deactivated",
    "policy.created",
    "policy.updated",
    "policy.deleted",
    "connection.established",
    "connection.revoked",
    "connection.degraded",
    "competence.promoted",
    "competence.demoted",
    "competence.updated",
    "delegation.chain_resolved",
    "entity.linked",
    "entity.unlinked",
    "entity.resolved",
  ],
  "Events & reactions": ["event.published", "event.reaction.triggered", "event.reaction.created"],
  "Agent & WorkTrace": [
    "agent.activated",
    "agent.emergency-halted",
    "agent.resumed",
    "work_trace.persisted",
    "work_trace.updated",
    "work_trace.integrity_override",
  ],
};
