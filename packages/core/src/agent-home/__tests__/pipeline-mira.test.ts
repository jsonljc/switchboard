import { describe, expect, it } from "vitest";
import { buildMiraPipelineViewModel, type MiraPipelineRow } from "../pipeline-mira.js";

const NOW = new Date("2026-05-28T12:00:00Z");

function row(o: Partial<MiraPipelineRow>): MiraPipelineRow {
  return {
    id: "j1",
    title: "Spring promo",
    status: "awaiting_review",
    createdAt: new Date("2026-05-27T12:00:00Z"),
    ...o,
  };
}

describe("buildMiraPipelineViewModel", () => {
  it("creatives kind/noun, mira setup link, draft-only ctx", () => {
    const vm = buildMiraPipelineViewModel({ rows: [row({})], totalCount: 1, now: NOW });
    expect(vm.agentKey).toBe("mira");
    expect(vm.pipelineKind).toBe("creatives");
    expect(vm.countNoun).toBe("creatives");
    expect(vm.setupLink).toEqual({ kind: "agent-setup", agentKey: "mira" });
    expect(vm.tiles[0]).toMatchObject({
      id: "j1",
      name: "Spring promo",
      link: { kind: "creative-job", id: "j1" },
    });
    expect(vm.tiles[0]!.ctx).toContain("review");
  });

  it("awaiting_review → hot stage; in_progress → new", () => {
    const vm = buildMiraPipelineViewModel({
      rows: [row({ id: "a", status: "awaiting_review" }), row({ id: "b", status: "in_progress" })],
      totalCount: 2,
      now: NOW,
    });
    expect(vm.tiles.find((t) => t.id === "a")!.stage).toBe("hot");
    expect(vm.tiles.find((t) => t.id === "b")!.stage).toBe("new");
  });

  it("empty → no tiles, totalCount 0", () => {
    const vm = buildMiraPipelineViewModel({ rows: [], totalCount: 0, now: NOW });
    expect(vm.tiles).toEqual([]);
    expect(vm.totalCount).toBe(0);
  });
});
