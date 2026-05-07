import { describe, expect, it, vi } from "vitest";
import { projectPipeline, type PipelineSignalStore } from "../pipeline.js";

const NOW = new Date("2026-05-07T08:00:00+08:00");
const TZ = "Asia/Singapore";

describe("projectPipeline", () => {
  it("dispatches Alex to listAlexPipeline", async () => {
    const listAlex = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "c1",
          name: "Maya",
          phone: null,
          stage: "active" as const,
          lastActivityAt: new Date("2026-05-07T05:00:00+08:00"),
        },
      ],
      totalCount: 1,
    });
    const store: PipelineSignalStore = {
      listAlexPipeline: listAlex,
      listRileyPipeline: vi.fn(),
    };

    const vm = await projectPipeline({
      orgId: "org-A",
      agentKey: "alex",
      now: NOW,
      timezone: TZ,
      store,
    });

    expect(listAlex).toHaveBeenCalledTimes(1);
    expect(listAlex.mock.calls[0]![0]).toMatchObject({ orgId: "org-A", limit: 5 });
    expect(vm.agentKey).toBe("alex");
    expect(vm.tiles).toHaveLength(1);
  });

  it("dispatches Riley to listRileyPipeline", async () => {
    const listRiley = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "p1",
          intent: "recommendation.pause_adset",
          riskLevel: "high" as const,
          dollarsAtRisk: 420,
          campaignName: "Whitening A",
          campaignId: "c-1",
          createdAt: new Date("2026-05-07T07:00:00+08:00"),
        },
      ],
      totalCount: 1,
    });
    const store: PipelineSignalStore = {
      listAlexPipeline: vi.fn(),
      listRileyPipeline: listRiley,
    };

    const vm = await projectPipeline({
      orgId: "org-A",
      agentKey: "riley",
      now: NOW,
      timezone: TZ,
      store,
    });

    expect(listRiley).toHaveBeenCalledTimes(1);
    expect(listRiley.mock.calls[0]![0]).toMatchObject({ orgId: "org-A", limit: 5 });
    expect(vm.agentKey).toBe("riley");
    expect(vm.tiles).toHaveLength(1);
  });

  it("uses PIPELINE_VISIBLE_LIMIT=5 when calling the store", async () => {
    const store: PipelineSignalStore = {
      listAlexPipeline: vi.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
      listRileyPipeline: vi.fn(),
    };
    await projectPipeline({ orgId: "org-A", agentKey: "alex", now: NOW, timezone: TZ, store });
    expect((store.listAlexPipeline as ReturnType<typeof vi.fn>).mock.calls[0]![0].limit).toBe(5);
  });

  it("sets activitySince to 7d ago for Alex", async () => {
    const listAlex = vi.fn().mockResolvedValue({ rows: [], totalCount: 0 });
    const store: PipelineSignalStore = {
      listAlexPipeline: listAlex,
      listRileyPipeline: vi.fn(),
    };
    await projectPipeline({ orgId: "org-A", agentKey: "alex", now: NOW, timezone: TZ, store });
    const args = listAlex.mock.calls[0]![0] as { activitySince: Date };
    const expectedMs = NOW.getTime() - 7 * 86_400_000;
    expect(args.activitySince.getTime()).toBe(expectedMs);
  });

  it("propagates totalCount unchanged through the projection", async () => {
    const store: PipelineSignalStore = {
      listAlexPipeline: vi.fn().mockResolvedValue({ rows: [], totalCount: 17 }),
      listRileyPipeline: vi.fn(),
    };
    const vm = await projectPipeline({
      orgId: "org-A",
      agentKey: "alex",
      now: NOW,
      timezone: TZ,
      store,
    });
    expect(vm.totalCount).toBe(17);
  });
});
