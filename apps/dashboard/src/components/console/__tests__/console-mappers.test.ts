import { describe, expect, it } from "vitest";
import {
  mapActivity,
  mapAgents,
  mapApprovalGateCard,
  mapConsoleData,
  mapEscalationCard,
  mapNumbersStrip,
  mapOpStrip,
  mapQueue,
} from "../console-mappers";

describe("mapOpStrip", () => {
  it("formats now as 'Day HH:MM AM/PM' and passes through orgName + dispatch", () => {
    const now = new Date("2026-04-30T10:42:00");
    const result = mapOpStrip("Aurora Dental", now, "live");
    expect(result.orgName).toBe("Aurora Dental");
    expect(result.dispatch).toBe("live");
    // e.g. "Thu 10:42 AM"
    expect(result.now).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} (AM|PM)$/);
  });
});

describe("mapNumbersStrip", () => {
  const baseInput = { leadsToday: 7, leadsYesterday: 5, bookingsToday: [] };

  it("returns 5 cells", () => {
    const result = mapNumbersStrip(baseInput);
    expect(result.cells).toHaveLength(5);
  });

  it("Leads cell uses today vs yesterday delta", () => {
    const result = mapNumbersStrip(baseInput);
    const leads = result.cells.find((c) => c.label === "Leads today");
    expect(leads?.value).toBe("7");
    expect(leads?.placeholder).not.toBe(true);
    expect(leads?.tone).toBe("good");
  });

  it("Leads cell tone is coral when down vs yesterday", () => {
    const result = mapNumbersStrip({ ...baseInput, leadsToday: 3 });
    const leads = result.cells.find((c) => c.label === "Leads today");
    expect(leads?.tone).toBe("coral");
  });

  it("Appointments cell shows count + next time + contact", () => {
    const result = mapNumbersStrip({
      ...baseInput,
      bookingsToday: [
        { startsAt: "2026-04-30T11:00:00", contactName: "Sarah" },
        { startsAt: "2026-04-30T14:30:00", contactName: "Marisol" },
      ],
    });
    const appts = result.cells.find((c) => c.label === "Appointments");
    expect(appts?.value).toBe("2");
    const text = JSON.stringify(appts?.delta);
    expect(text).toContain("11:00");
    expect(text).toContain("Sarah");
  });

  it("Revenue / Spend / Reply Time are placeholder cells with '—'", () => {
    const result = mapNumbersStrip(baseInput);
    const rev = result.cells.find((c) => c.label === "Revenue today");
    const spend = result.cells.find((c) => c.label === "Spend today");
    const reply = result.cells.find((c) => c.label === "Reply time");
    for (const cell of [rev, spend, reply]) {
      expect(cell?.placeholder).toBe(true);
      expect(cell?.value).toBe("—");
    }
  });
});

describe("mapEscalationCard", () => {
  it("maps a pending escalation row to an EscalationCard", () => {
    const row = {
      id: "esc-1",
      leadSnapshot: { name: "Sarah", channel: "WhatsApp" },
      reason: "Asking about a 15% discount.",
      conversationSummary: null,
      createdAt: "2026-04-30T10:38:00",
    };
    const now = new Date("2026-04-30T10:42:00");
    const card = mapEscalationCard(row, now);
    expect(card.kind).toBe("escalation");
    expect(card.id).toBe("esc-1");
    expect(card.contactName).toBe("Sarah");
    expect(card.channel).toBe("WhatsApp");
    expect(card.timer.ageDisplay).toContain("min ago");
    expect(card.timer.label).toBe("Urgent");
    expect(card.agent).toBe("alex");
    expect(card.issue.some((s) => typeof s === "string" && s.includes("15%"))).toBe(true);
  });

  it("falls back to 'Unknown' contact and '—' channel when leadSnapshot is missing", () => {
    const card = mapEscalationCard(
      {
        id: "esc-2",
        leadSnapshot: null,
        reason: "x",
        conversationSummary: null,
        createdAt: "2026-04-30T10:00:00",
      },
      new Date("2026-04-30T10:42:00"),
    );
    expect(card.contactName).toBe("Unknown");
    expect(card.channel).toBe("—");
  });
});

describe("mapApprovalGateCard", () => {
  it("maps a creative-risk approval row to an ApprovalGateCard", () => {
    const row = {
      id: "apr-1",
      summary: "Campaign 01 — Dental UGC Series",
      riskContext: "Hooks ready",
      riskCategory: "creative",
      createdAt: "2026-04-30T08:42:00",
    };
    const now = new Date("2026-04-30T10:42:00");
    const card = mapApprovalGateCard(row, now);
    expect(card.kind).toBe("approval_gate");
    expect(card.jobName).toBe("Campaign 01 — Dental UGC Series");
    expect(card.timer.stageLabel).toBe("Hooks ready");
    expect(card.timer.ageDisplay).toContain("h ago");
    expect(card.agent).toBe("mira");
    expect(card.stageProgress).toBe("—");
    expect(card.countdown).toBe("—");
  });
});

describe("mapQueue", () => {
  const now = new Date("2026-04-30T10:42:00");

  it("emits escalation cards before approval gate cards", () => {
    const queue = mapQueue(
      [
        {
          id: "e1",
          leadSnapshot: { name: "X" },
          reason: "r",
          conversationSummary: null,
          createdAt: "2026-04-30T10:30:00",
        },
      ],
      [
        {
          id: "a1",
          summary: "Campaign 1",
          riskContext: "Hooks ready",
          riskCategory: "creative",
          createdAt: "2026-04-30T09:00:00",
        },
      ],
      now,
    );
    expect(queue).toHaveLength(2);
    expect(queue[0].kind).toBe("escalation");
    expect(queue[1].kind).toBe("approval_gate");
  });

  it("filters approvals to creative-risk only", () => {
    const queue = mapQueue(
      [],
      [
        {
          id: "a1",
          summary: "x",
          riskContext: null,
          riskCategory: "low",
          createdAt: "2026-04-30T10:00:00",
        },
        {
          id: "a2",
          summary: "y",
          riskContext: "Hooks ready",
          riskCategory: "creative",
          createdAt: "2026-04-30T10:00:00",
        },
      ],
      now,
    );
    expect(queue).toHaveLength(1);
    expect((queue[0] as { id: string }).id).toBe("a2");
  });

  it("returns [] when both inputs empty", () => {
    expect(mapQueue([], [], now)).toEqual([]);
  });
});

describe("mapAgents", () => {
  it("returns 3 entries (Alex / Nova / Mira) with viewLink hrefs", () => {
    const result = mapAgents({ alex: true, nova: true, mira: true });
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.key)).toEqual(["alex", "nova", "mira"]);
    expect(result[0].viewLink.href).toBe("/conversations");
    expect(result[1].viewLink.href).toBe("/modules/ad-optimizer");
    expect(result[2].viewLink.href).toBe("/modules/creative");
  });

  it("makes Nova the active panel when enabled, otherwise Alex", () => {
    expect(mapAgents({ alex: true, nova: true, mira: true }).find((a) => a.active)?.key).toBe(
      "nova",
    );
    expect(mapAgents({ alex: true, nova: false, mira: true }).find((a) => a.active)?.key).toBe(
      "alex",
    );
  });

  it("primaryStat reads 'pending option C' until per-agent stats land", () => {
    const result = mapAgents({ alex: true, nova: true, mira: true });
    expect(result.every((a) => a.primaryStat === "pending option C")).toBe(true);
  });
});

describe("mapActivity", () => {
  it("formats createdAt to HH:MM and synthesizes agent from action prefix", () => {
    const result = mapActivity([
      { id: "1", action: "alex.replied", actorId: "agent:alex", createdAt: "2026-04-30T10:42:00" },
      {
        id: "2",
        action: "nova.draft.created",
        actorId: "agent:nova",
        createdAt: "2026-04-30T10:38:00",
      },
      { id: "3", action: "system.audit.tick", actorId: null, createdAt: "2026-04-30T10:00:00" },
    ]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].agent).toBe("alex");
    expect(result.rows[0].time).toBe("10:42");
    expect(result.rows[1].agent).toBe("nova");
    expect(result.rows[2].agent).toBe("system");
  });

  it("caps display at 9 rows and counts moreToday from today's overflow", () => {
    const today = new Date().toISOString();
    const entries = Array.from({ length: 14 }, (_, i) => ({
      id: `e${i}`,
      action: "alex.replied",
      actorId: "agent:alex",
      createdAt: today,
    }));
    const result = mapActivity(entries);
    expect(result.rows).toHaveLength(9);
    expect(result.moreToday).toBe(5);
  });
});

describe("mapConsoleData", () => {
  it("composes all sections into a ConsoleData shape", () => {
    const result = mapConsoleData({
      orgName: "Aurora Dental",
      now: new Date("2026-04-30T10:42:00"),
      dispatch: "live",
      leadsToday: 7,
      leadsYesterday: 5,
      bookingsToday: [{ startsAt: "2026-04-30T11:00:00", contactName: "Sarah" }],
      escalations: [],
      approvals: [],
      modules: { alex: true, nova: true, mira: true },
      auditEntries: [],
    });
    expect(result.opStrip.orgName).toBe("Aurora Dental");
    expect(result.numbers.cells).toHaveLength(5);
    expect(result.queue).toEqual([]);
    expect(result.queueLabel.count).toBe("0 pending");
    expect(result.agents).toHaveLength(3);
    expect(result.activity.rows).toEqual([]);
    // Nova panel stays fixture-shaped in option B (visual-only until C)
    expect(result.novaPanel.rows.length).toBeGreaterThan(0);
  });
});
