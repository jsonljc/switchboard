import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedMiraPilotOrgs } from "../seed-mira-pilot-orgs.js";

function mockPrisma() {
  return {
    orgAgentEnablement: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("seedMiraPilotOrgs", () => {
  it("upserts an enabled mira row per pilot org; idempotent", async () => {
    const prisma = mockPrisma();
    await seedMiraPilotOrgs(prisma, ["org1", "org2"]);
    const upsert = prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>;
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org1", agentKey: "mira" } },
      create: { orgId: "org1", agentKey: "mira", status: "enabled" },
      update: { status: "enabled" },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org2", agentKey: "mira" } },
      create: { orgId: "org2", agentKey: "mira", status: "enabled" },
      update: { status: "enabled" },
    });
  });

  it("no-op for empty pilot list (no global flip)", async () => {
    const prisma = mockPrisma();
    await seedMiraPilotOrgs(prisma, []);
    const upsert = prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>;
    expect(upsert).not.toHaveBeenCalled();
  });

  it("is idempotent — re-running for the same org does not throw", async () => {
    const prisma = mockPrisma();
    await seedMiraPilotOrgs(prisma, ["org1"]);
    await expect(seedMiraPilotOrgs(prisma, ["org1"])).resolves.toBeUndefined();
  });
});
