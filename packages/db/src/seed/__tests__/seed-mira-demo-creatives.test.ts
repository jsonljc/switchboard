import { describe, expect, it, vi } from "vitest";
import { seedMiraDemoCreatives } from "../seed-mira-demo-creatives.js";

describe("seedMiraDemoCreatives", () => {
  it("skips when the org has no deployment", async () => {
    const taskUpsert = vi.fn();
    const prisma = {
      agentDeployment: { findFirst: vi.fn().mockResolvedValue(null) },
      agentTask: { upsert: taskUpsert },
      creativeJob: { upsert: vi.fn() },
    } as unknown as import("@prisma/client").PrismaClient;
    await seedMiraDemoCreatives(prisma, "org_dev");
    expect(taskUpsert).not.toHaveBeenCalled();
  });

  it("seeds a polished + a UGC + a kept draft against the org's deployment", async () => {
    const creativeUpsert = vi.fn();
    const agentTaskUpsert = vi.fn();
    const prisma = {
      agentDeployment: { findFirst: vi.fn().mockResolvedValue({ id: "dep1", listingId: "lst1" }) },
      agentTask: { upsert: agentTaskUpsert },
      creativeJob: { upsert: creativeUpsert },
    } as unknown as import("@prisma/client").PrismaClient;
    await seedMiraDemoCreatives(prisma, "org_dev");
    expect(agentTaskUpsert).toHaveBeenCalledTimes(3);
    expect(creativeUpsert).toHaveBeenCalledTimes(3);
    const modes = creativeUpsert.mock.calls.map((c) => c[0].create.mode).sort();
    expect(modes).toEqual(["polished", "polished", "ugc"]);
    // One draft is pre-kept so the Desk shelf populates locally (set in BOTH upsert branches).
    const kept = creativeUpsert.mock.calls.filter((c) => c[0].create.reviewDecision === "kept");
    expect(kept).toHaveLength(1);
    expect(kept[0]![0].update.reviewDecision).toBe("kept");
  });
});
