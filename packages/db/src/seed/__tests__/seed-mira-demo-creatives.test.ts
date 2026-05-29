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

  it("seeds a polished + a UGC draft against the org's deployment", async () => {
    const creativeUpsert = vi.fn();
    const agentTaskUpsert = vi.fn();
    const prisma = {
      agentDeployment: { findFirst: vi.fn().mockResolvedValue({ id: "dep1", listingId: "lst1" }) },
      agentTask: { upsert: agentTaskUpsert },
      creativeJob: { upsert: creativeUpsert },
    } as unknown as import("@prisma/client").PrismaClient;
    await seedMiraDemoCreatives(prisma, "org_dev");
    expect(agentTaskUpsert).toHaveBeenCalledTimes(2);
    expect(creativeUpsert).toHaveBeenCalledTimes(2);
    const modes = creativeUpsert.mock.calls.map((c) => c[0].create.mode).sort();
    expect(modes).toEqual(["polished", "ugc"]);
  });
});
