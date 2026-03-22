import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaAgentRegistryStore } from "../prisma-agent-registry.js";

function mockPrisma() {
  return {
    agentRegistration: {
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({
        orgId: "org-1",
        agentId: "lead-responder",
        status: "active",
        executionMode: "realtime",
        config: {},
        capabilities: {},
        configVersion: 1,
      }),
    },
  };
}

describe("PrismaAgentRegistryStore", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  let store: PrismaAgentRegistryStore;

  beforeEach(() => {
    prisma = mockPrisma();
    store = new PrismaAgentRegistryStore(prisma as never);
  });

  it("persistRegistration upserts agent data to DB", async () => {
    await store.persistRegistration("org-1", {
      agentId: "lead-responder",
      status: "active",
      executionMode: "realtime",
      config: { threshold: 40 },
      capabilities: {},
    });

    expect(prisma.agentRegistration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_agentId: { orgId: "org-1", agentId: "lead-responder" } },
      }),
    );
  });

  it("loadAll returns all registrations for an org", async () => {
    prisma.agentRegistration.findMany.mockResolvedValue([
      {
        orgId: "org-1",
        agentId: "lead-responder",
        status: "active",
        executionMode: "realtime",
        config: { threshold: 40 },
        capabilities: { accepts: ["lead.received"] },
        configVersion: 2,
      },
    ]);

    const entries = await store.loadAll("org-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.agentId).toBe("lead-responder");
    expect(entries[0]!.configVersion).toBe(2);
  });
});
