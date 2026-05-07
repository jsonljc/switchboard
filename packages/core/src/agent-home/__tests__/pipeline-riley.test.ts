import { describe, expect, it } from "vitest";
import { buildRileyPipelineViewModel, type RileyPipelineRow } from "../pipeline-riley.js";

const NOW = new Date("2026-05-07T08:00:00+08:00");

function row(overrides: Partial<RileyPipelineRow> = {}): RileyPipelineRow {
  return {
    id: "p1",
    intent: "recommendation.pause_adset",
    riskLevel: "high",
    dollarsAtRisk: 420,
    campaignName: "Whitening A",
    campaignId: "c-1",
    createdAt: new Date("2026-05-07T07:00:00+08:00"),
    ...overrides,
  };
}

describe("buildRileyPipelineViewModel", () => {
  describe("classification matrix (§4.2)", () => {
    it("riskLevel=high → hot regardless of dollars", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ riskLevel: "high", dollarsAtRisk: 50 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.stage).toBe("hot");
    });

    it("riskLevel=medium + dollars≥500 → hot", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ riskLevel: "medium", dollarsAtRisk: 600 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.stage).toBe("hot");
    });

    it("riskLevel=medium + dollars<500 → warm", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ riskLevel: "medium", dollarsAtRisk: 200 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.stage).toBe("warm");
    });

    it("riskLevel=low + dollars≥100 → warm", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ riskLevel: "low", dollarsAtRisk: 150 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.stage).toBe("warm");
    });

    it("riskLevel=low + dollars<100 → new", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ riskLevel: "low", dollarsAtRisk: 50 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.stage).toBe("new");
    });
  });

  describe("ctx rendering", () => {
    it("uses known-intent map for pause_adset → 'pause'", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ intent: "recommendation.pause_adset", dollarsAtRisk: 420 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.ctx).toBe("$420 at risk · pause");
    });

    it("uses known-intent map for rotate_creative → 'rotate creative'", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ intent: "recommendation.rotate_creative", dollarsAtRisk: 80 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.ctx).toBe("$80 at risk · rotate creative");
    });

    it("uses known-intent map for scale_budget → 'scale budget'", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ intent: "recommendation.scale_budget", dollarsAtRisk: 1200 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.ctx).toBe("$1,200 at risk · scale budget");
    });

    it("falls back to underscore-stripped intent for unknown actions", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ intent: "recommendation.refresh_targeting", dollarsAtRisk: 300 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.ctx).toBe("$300 at risk · refresh targeting");
    });

    it("formats dollars with comma grouping, no decimals", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ dollarsAtRisk: 1234.5 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.ctx).toContain("$1,234");
    });

    it("renders '$0 at risk' when dollarsAtRisk is 0", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ dollarsAtRisk: 0 })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.ctx).toBe("$0 at risk · pause");
    });
  });

  describe("envelope", () => {
    it("uses campaignName for tile name and emits ad-set link kind", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [row({ campaignName: "Whitening A", campaignId: "c-1" })],
        totalCount: 1,
        now: NOW,
      });
      expect(vm.tiles[0]!.name).toBe("Whitening A");
      expect(vm.tiles[0]!.link).toEqual({ kind: "ad-set", id: "c-1" });
    });

    it("returns the envelope shape required by PipelineViewModel", () => {
      const vm = buildRileyPipelineViewModel({ rows: [], totalCount: 0, now: NOW });
      expect(vm.agentKey).toBe("riley");
      expect(vm.pipelineKind).toBe("ad-sets");
      expect(vm.countNoun).toBe("ad sets");
      expect(vm.totalCount).toBe(0);
      expect(vm.tiles).toEqual([]);
      expect(vm.setupLink).toEqual({ kind: "agent-setup", agentKey: "riley" });
      expect(vm.freshness.dataSource).toBe("live");
    });

    it("preserves the store-side ordering", () => {
      const vm = buildRileyPipelineViewModel({
        rows: [
          row({ id: "first", riskLevel: "high" }),
          row({ id: "second", riskLevel: "medium" }),
          row({ id: "third", riskLevel: "low" }),
        ],
        totalCount: 3,
        now: NOW,
      });
      expect(vm.tiles.map((t) => t.id)).toEqual(["first", "second", "third"]);
    });
  });
});
