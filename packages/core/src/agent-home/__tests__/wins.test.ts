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
