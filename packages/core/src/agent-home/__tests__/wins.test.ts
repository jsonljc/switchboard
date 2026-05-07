import { describe, expect, it } from "vitest";
import { projectWins, type WinsSignalStore, type WinTerminalRecord } from "../wins.js";

function inMemoryStore(rows: WinTerminalRecord[]): WinsSignalStore {
  return {
    async listResolvedForAgent({ statuses, limit }) {
      return rows.filter((r) => statuses.includes(r.status)).slice(0, limit);
    },
  };
}

describe("projectWins — skeleton", () => {
  it("returns empty wins list with hasMore=false when no rows", async () => {
    const vm = await projectWins({
      orgId: "org-1",
      agentKey: "alex",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([]),
    });
    expect(vm.wins).toEqual([]);
    expect(vm.hasMore).toBe(false);
    expect(vm.freshness.dataSource).toBe("live");
    expect(vm.freshness.window).toBe("today");
    expect(vm.freshness.generatedAt).toBe("2026-05-07T06:30:00.000Z");
  });
});

describe("projectWins — voice & prose", () => {
  const baseRow = {
    id: "r1",
    intent: "recommendation.send_tour_invite",
    humanSummary: "Sent tour invite to Maya",
    occurredAt: new Date("2026-05-07T03:42:00.000Z"),
    undoableUntil: null,
    targetEntities: {},
  };

  it("alex prose leads with the alex ack phrase", async () => {
    const vm = await projectWins({
      orgId: "org-1",
      agentKey: "alex",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, agentKey: "alex", status: "acted" }]),
    });
    expect(vm.wins[0].proseSegments[0]).toEqual({ kind: "accent", text: "Sent." });
    expect(vm.wins[0].proseSegments.map((s) => s.text).join("")).toContain("Maya");
  });

  it("riley prose leads with the riley ack phrase", async () => {
    const vm = await projectWins({
      orgId: "org-1",
      agentKey: "riley",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([
        { ...baseRow, agentKey: "riley", status: "acted", humanSummary: "Adjusted ad-set bid" },
      ]),
    });
    expect(vm.wins[0].proseSegments[0]).toEqual({ kind: "accent", text: "Adjusted." });
    expect(vm.wins[0].proseSegments.map((s) => s.text).join("")).toContain("ad-set bid");
  });

  it("prose for alex differs from prose for riley (verifiable voice divergence)", async () => {
    const alex = await projectWins({
      orgId: "org-1",
      agentKey: "alex",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, agentKey: "alex", status: "acted" }]),
    });
    const riley = await projectWins({
      orgId: "org-1",
      agentKey: "riley",
      window: "today",
      now: new Date("2026-05-07T06:30:00.000Z"),
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, agentKey: "riley", status: "acted" }]),
    });
    expect(alex.wins[0].proseSegments[0].text).not.toBe(riley.wins[0].proseSegments[0].text);
  });
});

describe("projectWins — undo", () => {
  const baseRow = {
    id: "r1",
    agentKey: "alex" as const,
    intent: "recommendation.send_tour_invite",
    humanSummary: "Sent tour invite",
    occurredAt: new Date("2026-05-07T03:42:00.000Z"),
    targetEntities: {},
  };
  const now = new Date("2026-05-07T06:30:00.000Z");

  it("acted: not reversible (no button), until null", async () => {
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "acted", undoableUntil: null }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: false,
      until: null,
      unavailableReason: "not-reversible",
    });
  });

  it("confirmed + future undoableUntil: available", async () => {
    const future = new Date(now.getTime() + 60_000); // 1 min ahead
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "confirmed", undoableUntil: future }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: true,
      until: future.toISOString(),
    });
  });

  it("confirmed + past undoableUntil: expired", async () => {
    const past = new Date(now.getTime() - 60_000);
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "confirmed", undoableUntil: past }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: false,
      until: past.toISOString(),
      unavailableReason: "expired",
    });
  });

  it("confirmed without undoableUntil: not-reversible (defensive)", async () => {
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now,
      timezone: "Asia/Singapore",
      store: inMemoryStore([{ ...baseRow, status: "confirmed", undoableUntil: null }]),
    });
    expect(vm.wins[0].undo).toEqual({
      available: false,
      until: null,
      unavailableReason: "not-reversible",
    });
  });
});

describe("projectWins — pagination", () => {
  it("caps wins at 5 and sets hasMore when more rows exist", async () => {
    const rows: WinTerminalRecord[] = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      agentKey: "alex",
      status: "acted",
      intent: "recommendation.x",
      humanSummary: `summary ${i}`,
      occurredAt: new Date(),
      undoableUntil: null,
      targetEntities: {},
    }));
    const vm = await projectWins({
      orgId: "o",
      agentKey: "alex",
      window: "today",
      now: new Date(),
      timezone: "Asia/Singapore",
      store: inMemoryStore(rows),
    });
    expect(vm.wins).toHaveLength(5);
    expect(vm.hasMore).toBe(true);
  });
});
