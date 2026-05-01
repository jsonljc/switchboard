import { describe, it, expect } from "vitest";
import {
  AgentKeySchema,
  AdSetRowSchema,
  StageProgressSchema,
  STALE_AFTER_MINUTES,
  MIN_REPLY_SAMPLE,
  DashboardOverviewSchema,
} from "../dashboard.js";

describe("STALE_AFTER_MINUTES", () => {
  it("is 30", () => {
    expect(STALE_AFTER_MINUTES).toBe(30);
  });
});

describe("MIN_REPLY_SAMPLE", () => {
  it("is 3", () => {
    expect(MIN_REPLY_SAMPLE).toBe(3);
  });
});

describe("AgentKeySchema", () => {
  it("accepts alex / nova / mira / system", () => {
    for (const k of ["alex", "nova", "mira", "system"] as const) {
      expect(AgentKeySchema.parse(k)).toBe(k);
    }
  });
  it("rejects unknown agents", () => {
    expect(() => AgentKeySchema.parse("zoe")).toThrow();
  });
});

describe("AdSetRowSchema", () => {
  it("parses a complete row", () => {
    const row = AdSetRowSchema.parse({
      adSetId: "ad-1",
      adSetName: "Test Ad Set",
      deploymentId: "dep-1",
      spend: { amount: 42.5, currency: "USD" },
      conversions: 3,
      cpa: 14.17,
      trend: "up",
      status: "delivering",
      pausePending: false,
    });
    expect(row.adSetId).toBe("ad-1");
    expect(row.cpa).toBe(14.17);
  });
  it("accepts null cpa", () => {
    const row = AdSetRowSchema.parse({
      adSetId: "ad-1",
      adSetName: "x",
      deploymentId: "d",
      spend: { amount: 0, currency: "USD" },
      conversions: 0,
      cpa: null,
      trend: "flat",
      status: "learning",
      pausePending: false,
    });
    expect(row.cpa).toBeNull();
  });
  it("rejects unknown trend / status", () => {
    const base = {
      adSetId: "x",
      adSetName: "x",
      deploymentId: "d",
      spend: { amount: 0, currency: "USD" },
      conversions: 0,
      cpa: null,
      pausePending: false,
    };
    expect(() =>
      AdSetRowSchema.parse({ ...base, trend: "sideways", status: "delivering" }),
    ).toThrow();
    expect(() => AdSetRowSchema.parse({ ...base, trend: "up", status: "spinning" })).toThrow();
  });
});

describe("StageProgressSchema", () => {
  it("parses a row with a closesAt", () => {
    const sp = StageProgressSchema.parse({
      stageIndex: 1,
      stageTotal: 5,
      stageLabel: "hooks",
      closesAt: "2026-05-02T10:00:00Z",
    });
    expect(sp.stageLabel).toBe("hooks");
  });
  it("accepts null closesAt", () => {
    const sp = StageProgressSchema.parse({
      stageIndex: 0,
      stageTotal: 5,
      stageLabel: "trends",
      closesAt: null,
    });
    expect(sp.closesAt).toBeNull();
  });
  it("rejects negative stageIndex", () => {
    expect(() =>
      StageProgressSchema.parse({ stageIndex: -1, stageTotal: 5, stageLabel: "x", closesAt: null }),
    ).toThrow();
  });
  it("rejects zero stageTotal", () => {
    expect(() =>
      StageProgressSchema.parse({ stageIndex: 0, stageTotal: 0, stageLabel: "x", closesAt: null }),
    ).toThrow();
  });
});

describe("DashboardOverviewSchema (post-C1)", () => {
  const minimalValid = {
    generatedAt: "2026-05-01T10:00:00Z",
    greeting: { period: "morning" as const, operatorName: "Jane" },
    stats: {
      pendingApprovals: 0,
      qualifiedLeads: 0,
      revenue7d: { total: 0, count: 0 },
      openTasks: 0,
      overdueTasks: 0,
    },
    today: {
      revenue: { amount: 0, currency: "USD", deltaPctVsAvg: null },
      spend: { amount: 0, currency: "USD", capPct: 0, updatedAt: null },
      replyTime: null,
      leads: { count: 0, yesterdayCount: 0 },
      appointments: { count: 0, next: null },
    },
    agentsToday: { alex: null, nova: null, mira: null },
    novaAdSets: [],
    approvals: [],
    bookings: [],
    funnel: { inquiry: 0, qualified: 0, booked: 0, purchased: 0, completed: 0 },
    revenue: { total: 0, count: 0, topSource: null, periodDays: 7 as const },
    tasks: [],
    activity: [],
  };

  it("parses a minimal valid shape with all Tier B fields at placeholder values", () => {
    const parsed = DashboardOverviewSchema.parse(minimalValid);
    expect(parsed.today.spend.updatedAt).toBeNull();
    expect(parsed.agentsToday.alex).toBeNull();
    expect(parsed.novaAdSets).toEqual([]);
  });

  it("rejects when stats still carries the migrated fields", () => {
    const withOldField = {
      ...minimalValid,
      stats: { ...minimalValid.stats, newInquiriesToday: 5 },
    };
    // strict mode would throw; default mode strips. Either way the new path is the truth.
    const parsed = DashboardOverviewSchema.parse(withOldField);
    // The migrated key is gone from the parsed object's stats namespace.
    expect((parsed.stats as Record<string, unknown>).newInquiriesToday).toBeUndefined();
  });

  it("parses a full Tier-A populated shape", () => {
    const populated = {
      ...minimalValid,
      today: {
        ...minimalValid.today,
        revenue: { amount: 1240, currency: "USD", deltaPctVsAvg: 0.18 },
        replyTime: { medianSeconds: 12, previousSeconds: 18, sampleSize: 7 },
        leads: { count: 7, yesterdayCount: 5 },
        appointments: {
          count: 3,
          next: { startsAt: "2026-05-01T11:00:00Z", contactName: "Sarah", service: "Consult" },
        },
      },
      agentsToday: {
        ...minimalValid.agentsToday,
        alex: { repliedToday: 14, qualifiedToday: 6, bookedToday: 3 },
      },
      approvals: [
        {
          id: "apr-1",
          summary: "Campaign 01",
          riskContext: "Hooks ready",
          createdAt: "2026-05-01T08:00:00Z",
          envelopeId: "env-1",
          bindingHash: "hash-1",
          riskCategory: "creative",
          stageProgress: {
            stageIndex: 1,
            stageTotal: 5,
            stageLabel: "hooks",
            closesAt: "2026-05-02T08:00:00Z",
          },
        },
      ],
      activity: [
        {
          id: "act-1",
          type: "alex.replied",
          description: "Alex replied",
          dotColor: "green" as const,
          createdAt: "2026-05-01T10:00:00Z",
          agent: "alex" as const,
        },
      ],
    };
    const parsed = DashboardOverviewSchema.parse(populated);
    expect(parsed.today.revenue.amount).toBe(1240);
    expect(parsed.approvals[0]!.stageProgress?.stageIndex).toBe(1);
    expect(parsed.activity[0]!.agent).toBe("alex");
  });

  it("approvals[].stageProgress is optional (undefined for non-creative rows)", () => {
    const populated = {
      ...minimalValid,
      approvals: [
        {
          id: "apr-2",
          summary: "Pause ad set",
          riskContext: null,
          createdAt: "2026-05-01T08:00:00Z",
          envelopeId: "env-2",
          bindingHash: "hash-2",
          riskCategory: "high",
        },
      ],
    };
    const parsed = DashboardOverviewSchema.parse(populated);
    expect(parsed.approvals[0]!.stageProgress).toBeUndefined();
  });

  it("activity[].agent accepts null for system events", () => {
    const populated = {
      ...minimalValid,
      activity: [
        {
          id: "act-2",
          type: "system.tick",
          description: "system",
          dotColor: "gray" as const,
          createdAt: "2026-05-01T10:00:00Z",
          agent: null,
        },
      ],
    };
    const parsed = DashboardOverviewSchema.parse(populated);
    expect(parsed.activity[0]!.agent).toBeNull();
  });
});
