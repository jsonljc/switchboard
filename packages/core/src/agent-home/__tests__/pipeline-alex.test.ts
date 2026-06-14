import { describe, expect, it } from "vitest";
import { buildAlexPipelineViewModel, type AlexPipelineRow } from "../pipeline-alex.js";

const TZ = "Asia/Singapore";
const NOW = new Date("2026-05-07T08:00:00+08:00");

function row(overrides: Partial<AlexPipelineRow> = {}): AlexPipelineRow {
  return {
    id: "c1",
    name: "Maya R.",
    phone: "+6591234567",
    stage: "active",
    lastActivityAt: new Date("2026-05-07T05:00:00+08:00"), // 3h ago
    ...overrides,
  };
}

describe("buildAlexPipelineViewModel", () => {
  it("classifies in-window stage='active' rows as hot (recency already filtered upstream by listForPipeline)", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ stage: "active", lastActivityAt: new Date("2026-05-04T08:00:00+08:00") })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.stage).toBe("hot");
  });

  it("classifies stage='new' + <24h as warm", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ stage: "new", lastActivityAt: new Date("2026-05-07T05:00:00+08:00") })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.stage).toBe("warm");
  });

  it("classifies stage='new' + 24h-7d as new", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ stage: "new", lastActivityAt: new Date("2026-05-04T08:00:00+08:00") })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.stage).toBe("new");
  });

  it("renders ctx 'In conversation · 3h ago' for active stage", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ stage: "active", lastActivityAt: new Date("2026-05-07T05:00:00+08:00") })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.ctx).toBe("In conversation · 3h ago");
  });

  it("renders ctx 'New lead · 3d ago' for new stage", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ stage: "new", lastActivityAt: new Date("2026-05-04T08:00:00+08:00") })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.ctx).toBe("New lead · 3d ago");
  });

  it("falls back to phone last-4 when name is null", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ name: null, phone: "+6591234567" })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.name).toBe("…4567");
  });

  it("falls back to 'Unnamed lead' when name and phone are both null", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ name: null, phone: null })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.name).toBe("Unnamed lead");
  });

  it("falls back to 'Unnamed lead' when the phone has fewer than 4 digits", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row({ name: null, phone: "12" })],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.name).toBe("Unnamed lead");
  });

  it("emits tiles with link kind 'contact'", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [row()],
      totalCount: 1,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.tiles[0]!.link).toEqual({ kind: "contact", id: "c1" });
  });

  it("returns the envelope shape required by PipelineViewModel", () => {
    const vm = buildAlexPipelineViewModel({
      rows: [],
      totalCount: 0,
      now: NOW,
      timezone: TZ,
    });
    expect(vm.agentKey).toBe("alex");
    expect(vm.pipelineKind).toBe("leads");
    expect(vm.countNoun).toBe("people");
    expect(vm.totalCount).toBe(0);
    expect(vm.tiles).toEqual([]);
    expect(vm.setupLink).toEqual({ kind: "agent-setup", agentKey: "alex" });
    expect(vm.freshness.dataSource).toBe("live");
    expect(vm.freshness.window).toBe("today");
    expect(vm.freshness.generatedAt).toBe(NOW.toISOString());
  });
});
