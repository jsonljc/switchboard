import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedOrgDayOneAgents } from "../seed-org-day-one-agents.js";

function mockPrisma() {
  return {
    orgAgentEnablement: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("seedOrgDayOneAgents", () => {
  it("upserts an enabled row for each day-one agent (Alex + Riley)", async () => {
    const prisma = mockPrisma();
    await seedOrgDayOneAgents(prisma, "org-new");
    const calls = (prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>).mock.calls;
    const seededKeys = calls.map((c) => c[0].where.orgId_agentKey.agentKey).sort();
    expect(seededKeys).toEqual(["alex", "riley"]);
  });

  it("does NOT seed Mira (launchTier=day-thirty)", async () => {
    const prisma = mockPrisma();
    await seedOrgDayOneAgents(prisma, "org-new");
    const calls = (prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>).mock.calls;
    const seededKeys = calls.map((c) => c[0].where.orgId_agentKey.agentKey);
    expect(seededKeys).not.toContain("mira");
  });

  it("is idempotent — re-running for the same org does not throw", async () => {
    const prisma = mockPrisma();
    await seedOrgDayOneAgents(prisma, "org-new");
    await expect(seedOrgDayOneAgents(prisma, "org-new")).resolves.toBeUndefined();
  });
});
