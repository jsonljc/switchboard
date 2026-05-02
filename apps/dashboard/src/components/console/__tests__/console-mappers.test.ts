import { describe, expect, it } from "vitest";
import { mapApprovalGateCard, mapEscalationCard, mapQueue } from "../console-mappers";

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
      bindingHash: "hash-apr-1",
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
    expect(card.approvalId).toBe("apr-1");
    expect(card.bindingHash).toBe("hash-apr-1");
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
          bindingHash: "h-a1",
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
          bindingHash: "h-a1",
          createdAt: "2026-04-30T10:00:00",
        },
        {
          id: "a2",
          summary: "y",
          riskContext: "Hooks ready",
          riskCategory: "creative",
          bindingHash: "h-a2",
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
