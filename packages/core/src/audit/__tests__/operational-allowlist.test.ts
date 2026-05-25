import { describe, it, expect } from "vitest";
import {
  OPERATIONAL_AUDIT_EVENT_TYPES,
  AuditEventTypeSchema,
  type AuditEventType,
} from "@switchboard/schemas";

describe("OPERATIONAL_AUDIT_EVENT_TYPES", () => {
  // Pinned literal — the canonical source of truth for the operational allowlist.
  // Editing this must be a deliberate review-forcing change. Update both this
  // literal and the constant in packages/schemas/src/audit.ts together.
  const EXPECTED: readonly AuditEventType[] = [
    "action.approved",
    "action.partially_approved",
    "action.rejected",
    "action.executed",
    "action.failed",
    "action.denied",
    "action.expired",
    "action.cancelled",
    "action.undo_requested",
    "action.undo_executed",
    "action.approval_expired",
    "agent.activated",
    "agent.emergency-halted",
    "agent.resumed",
    "policy.created",
    "policy.updated",
    "policy.deleted",
    "connection.established",
    "connection.revoked",
    "connection.degraded",
    "competence.promoted",
    "competence.demoted",
    "identity.created",
    "identity.updated",
    "overlay.activated",
    "overlay.deactivated",
    "work_trace.integrity_override",
    "infrastructure.job.retry_exhausted",
  ];

  it("matches the pinned literal set (deep equal, exact order)", () => {
    expect([...OPERATIONAL_AUDIT_EVENT_TYPES]).toEqual([...EXPECTED]);
  });

  it("every entry is a member of AuditEventTypeSchema", () => {
    for (const eventType of OPERATIONAL_AUDIT_EVENT_TYPES) {
      const result = AuditEventTypeSchema.safeParse(eventType);
      expect(result.success).toBe(true);
    }
  });

  // Positive regression — operator-relevant despite the work_trace.* prefix.
  // Prevents a careless future edit from grouping integrity_override back with
  // its noisier siblings.
  it("INCLUDES work_trace.integrity_override (operator-relevant)", () => {
    expect(OPERATIONAL_AUDIT_EVENT_TYPES).toContain("work_trace.integrity_override");
  });

  // Negative regressions — these events are deliberately OUT of Operational.
  // Each entry has a documented reason in spec §2.4.
  describe("excludes (regression)", () => {
    const EXCLUDED: AuditEventType[] = [
      // Persistence telemetry — too frequent to be informative.
      "work_trace.persisted",
      "work_trace.updated",
      // Lifecycle starts and intermediate states.
      "action.proposed",
      "action.resolved",
      "action.enriched",
      "action.evaluated",
      "action.patched",
      "action.queued",
      "action.executing",
      "action.snapshot",
      // Vague auto-bookkeeping.
      "competence.updated",
      // Internal orchestration.
      "delegation.chain_resolved",
      "event.published",
      "event.reaction.triggered",
      "event.reaction.created",
      // Linkage bookkeeping.
      "entity.linked",
      "entity.unlinked",
      "entity.resolved",
    ];

    it.each(EXCLUDED)("does NOT include %s", (eventType) => {
      expect(OPERATIONAL_AUDIT_EVENT_TYPES).not.toContain(eventType);
    });
  });
});
