import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeQualifyLead } from "../qualify-lead.js";
import { executeEscalate, setEscalationNotifier } from "../escalate.js";
import { executeDiagnosePipeline } from "../diagnose-pipeline.js";
import type { ContactMetricsSnapshot } from "../../../core/types.js";

describe("executeQualifyLead", () => {
  it("should qualify a high-scoring lead", async () => {
    const result = await executeQualifyLead({
      contactId: "c-1",
      serviceValue: 500,
      urgencyLevel: 9,
      hasInsurance: true,
      engagementScore: 8,
      budgetIndicator: 8,
    });
    expect(result.success).toBe(true);
    expect(result.data?.qualified).toBe(true);
    expect(result.summary).toContain("qualified");
  });

  it("should not qualify a low-scoring lead", async () => {
    const result = await executeQualifyLead({
      contactId: "c-2",
      serviceValue: 0,
      urgencyLevel: 1,
      hasInsurance: false,
      engagementScore: 1,
      budgetIndicator: 1,
    });
    expect(result.success).toBe(true);
    expect(result.data?.qualified).toBe(false);
    expect(result.summary).toContain("not qualified");
  });

  it("should emit conversion event when lead qualifies with conversionBus", async () => {
    const emit = vi.fn();
    const result = await executeQualifyLead(
      {
        contactId: "c-1",
        serviceValue: 500,
        urgencyLevel: 9,
        hasInsurance: true,
        engagementScore: 8,
        budgetIndicator: 8,
      },
      { conversionBus: { emit } as never, organizationId: "org-1" },
    );
    expect(result.data?.qualified).toBe(true);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "qualified", contactId: "c-1" }),
    );
  });
});

describe("executeEscalate", () => {
  beforeEach(() => {
    setEscalationNotifier(null as never);
  });

  it("should escalate without notifier", async () => {
    const result = await executeEscalate({
      contactId: "c-1",
      reason: "patient upset",
    });
    expect(result.success).toBe(true);
    expect(result.summary).toContain("patient upset");
    expect(result.data?.status).toBe("pending_human_review");
  });

  it("should send notification when notifier is set", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    setEscalationNotifier({ notify });

    const result = await executeEscalate({
      contactId: "c-1",
      reason: "complex question",
      conversationId: "conv-1",
    });
    expect(result.success).toBe(true);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "c-1",
        reason: "complex question",
        conversationId: "conv-1",
      }),
    );
    expect(result.data?.notificationSent).toBe(true);
  });

  it("should handle notification failure gracefully", async () => {
    const notify = vi.fn().mockRejectedValue(new Error("Slack down"));
    setEscalationNotifier({ notify });

    const result = await executeEscalate({ contactId: "c-1", reason: "test" });
    expect(result.success).toBe(true); // escalation still succeeds
    expect(result.partialFailures).toHaveLength(1);
    expect(result.partialFailures[0]?.error).toBe("Slack down");
  });
});

describe("executeDiagnosePipeline", () => {
  function makeSnapshot(overrides: Partial<ContactMetricsSnapshot> = {}): ContactMetricsSnapshot {
    return {
      organizationId: "org-1",
      periodStart: "2024-01-01",
      periodEnd: "2024-01-07",
      totalContacts: 100,
      stages: {
        new_leads: { count: 50, averageValue: null },
        qualified_leads: { count: 30, averageValue: null },
        consultations_booked: { count: 20, averageValue: null },
        consultations_completed: { count: 18, averageValue: null },
        services_proposed: { count: 15, averageValue: 500 },
        services_accepted: { count: 12, averageValue: 500 },
        services_scheduled: { count: 10, averageValue: 500 },
        services_completed: { count: 8, averageValue: 500 },
        repeat_customers: { count: 3, averageValue: 600 },
      },
      aggregates: {
        averageServiceValue: 500,
        totalRevenue: 4000,
        noShowRate: 0.1,
        cancellationRate: 0.05,
        averageResponseTimeMs: 900000,
        reviewRating: 4.5,
        reviewCount: 5,
        referralCount: 2,
      },
      ...overrides,
    };
  }

  it("should diagnose pipeline and return findings", async () => {
    const result = await executeDiagnosePipeline(
      { organizationId: "org-1", businessType: "dental" },
      makeSnapshot(),
      makeSnapshot({ periodStart: "2023-12-25", periodEnd: "2024-01-01" }),
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain("org-1");
    expect(result.data).toBeDefined();
  });
});
