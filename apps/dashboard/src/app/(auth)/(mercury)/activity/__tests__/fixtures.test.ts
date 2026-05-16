import { describe, it, expect } from "vitest";
import { AuditEntryBrowseRowSchema, OPERATIONAL_AUDIT_EVENT_TYPES } from "@switchboard/schemas";
import { ACTIVITY_FIXTURES } from "../fixtures";

describe("ACTIVITY_FIXTURES (v2 distribution)", () => {
  it("contains exactly 30 rows", () => {
    expect(ACTIVITY_FIXTURES).toHaveLength(30);
  });

  it("every row parses against AuditEntryBrowseRowSchema", () => {
    for (const row of ACTIVITY_FIXTURES) {
      expect(() => AuditEntryBrowseRowSchema.parse(row)).not.toThrow();
    }
  });

  it("is DESC-ordered by timestamp", () => {
    for (let i = 0; i < ACTIVITY_FIXTURES.length - 1; i++) {
      const a = new Date(ACTIVITY_FIXTURES[i]!.timestamp).getTime();
      const b = new Date(ACTIVITY_FIXTURES[i + 1]!.timestamp).getTime();
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("threads a head-to-tail hash chain (rows[i].previousEntryHash === rows[i+1].entryHash)", () => {
    for (let i = 0; i < ACTIVITY_FIXTURES.length - 1; i++) {
      expect(ACTIVITY_FIXTURES[i]!.previousEntryHash).toBe(ACTIVITY_FIXTURES[i + 1]!.entryHash);
    }
  });

  it("covers all 4 actor types", () => {
    const types = new Set(ACTIVITY_FIXTURES.map((r) => r.actorType));
    expect(types).toEqual(new Set(["user", "agent", "system", "service_account"]));
  });

  it("includes at least 22 distinct event types", () => {
    const evts = new Set(ACTIVITY_FIXTURES.map((r) => r.eventType));
    expect(evts.size).toBeGreaterThanOrEqual(22);
  });

  it("includes at least one row outside the operational allowlist", () => {
    const operational = new Set<string>(OPERATIONAL_AUDIT_EVENT_TYPES);
    const offAllowlist = ACTIVITY_FIXTURES.filter((r) => !operational.has(r.eventType));
    expect(offAllowlist.length).toBeGreaterThanOrEqual(1);
  });

  it("includes at least 4 rows with envelopeId set", () => {
    const withEnvelope = ACTIVITY_FIXTURES.filter((r) => r.envelopeId !== null);
    expect(withEnvelope.length).toBeGreaterThanOrEqual(4);
  });

  it("includes at least 2 rows with redactedKeyCount > 0", () => {
    const redacted = ACTIVITY_FIXTURES.filter((r) => r.redactedKeyCount > 0);
    expect(redacted.length).toBeGreaterThanOrEqual(2);
  });

  it("covers all 5 risk categories at least once", () => {
    const risks = new Set(ACTIVITY_FIXTURES.map((r) => r.riskCategory));
    expect(risks).toEqual(new Set(["none", "low", "medium", "high", "critical"]));
  });
});
