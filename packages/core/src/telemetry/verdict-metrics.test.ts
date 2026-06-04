import { describe, it, expect, vi, afterEach } from "vitest";
import { setMetrics, createInMemoryMetrics } from "./metrics.js";
import { recordGovernanceVerdictMetric } from "./verdict-metrics.js";
import type { GovernanceVerdictRecord } from "../governance/governance-verdict-store/types.js";

const record: GovernanceVerdictRecord = {
  id: "v1",
  deploymentId: "dep_1",
  conversationId: "sess_1",
  action: "allow",
  reasonCode: "consent_revoked",
  jurisdiction: "SG",
  clinicType: "medical",
  sourceGuard: "consent_gate",
  auditLevel: "warning",
  decidedAt: "2026-06-04T00:00:00.000Z",
  details: null,
  createdAt: "2026-06-04T00:00:00.000Z",
};

afterEach(() => {
  setMetrics(createInMemoryMetrics());
});

describe("recordGovernanceVerdictMetric", () => {
  it("increments the counter with the verdict's label set", async () => {
    const inc = vi.fn();
    setMetrics({
      ...createInMemoryMetrics(),
      governanceVerdictsRecorded: { inc },
    });

    await recordGovernanceVerdictMetric(record);

    expect(inc).toHaveBeenCalledWith({
      deployment_id: "dep_1",
      source_guard: "consent_gate",
      action: "allow",
      audit_level: "warning",
    });
  });

  it("never throws even when the counter increment does", async () => {
    // The store's onWrite contract propagates errors to save() callers, and the
    // whatsapp gate awaits save() bare inside the fail-closed afterSkill seam —
    // a metric failure must never be able to degrade a lead reply.
    setMetrics({
      ...createInMemoryMetrics(),
      governanceVerdictsRecorded: {
        inc: () => {
          throw new Error("registry exploded");
        },
      },
    });

    await expect(recordGovernanceVerdictMetric(record)).resolves.toBeUndefined();
  });
});
