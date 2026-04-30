import { describe, expect, it } from "vitest";
import {
  mapApprovalGateCard,
  mapEscalationCard,
  mapNumbersStrip,
  mapOpStrip,
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
