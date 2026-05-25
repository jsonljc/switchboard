import { describe, it, expect } from "vitest";
import { AuditEventTypeSchema, OPERATIONAL_AUDIT_EVENT_TYPES } from "../audit.js";

describe("infrastructure.job.retry_exhausted event type", () => {
  it("is a valid AuditEventType", () => {
    expect(() => AuditEventTypeSchema.parse("infrastructure.job.retry_exhausted")).not.toThrow();
  });

  it("is in the operational allowlist so operators see it by default", () => {
    expect(OPERATIONAL_AUDIT_EVENT_TYPES).toContain("infrastructure.job.retry_exhausted");
  });
});
