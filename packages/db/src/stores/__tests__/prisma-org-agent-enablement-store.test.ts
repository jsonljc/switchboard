import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PrismaOrgAgentEnablementStore } from "../prisma-org-agent-enablement-store.js";

function mockPrisma() {
  return {
    orgAgentEnablement: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("PrismaOrgAgentEnablementStore", () => {
  it("list calls findMany with orgId filter and orderBy enabledAt asc", async () => {
    const prisma = mockPrisma();
    (prisma.orgAgentEnablement.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "row-1",
        orgId: "org-1",
        agentKey: "alex",
        status: "enabled",
        enabledAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    const store = new PrismaOrgAgentEnablementStore(prisma);
    const rows = await store.list("org-1");
    expect(prisma.orgAgentEnablement.findMany).toHaveBeenCalledWith({
      where: { orgId: "org-1" },
      orderBy: { enabledAt: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentKey).toBe("alex");
  });

  it("enable calls upsert keyed on (orgId, agentKey)", async () => {
    const prisma = mockPrisma();
    (prisma.orgAgentEnablement.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "row-1",
      orgId: "org-1",
      agentKey: "riley",
      status: "enabled",
      enabledAt: new Date(),
      updatedAt: new Date(),
    });
    const store = new PrismaOrgAgentEnablementStore(prisma);
    await store.enable("org-1", "riley");
    expect(prisma.orgAgentEnablement.upsert).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org-1", agentKey: "riley" } },
      create: expect.objectContaining({
        orgId: "org-1",
        agentKey: "riley",
        status: "enabled",
      }),
      update: { status: "enabled" },
    });
  });

  it("setStatus calls update keyed on (orgId, agentKey)", async () => {
    const prisma = mockPrisma();
    (prisma.orgAgentEnablement.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const store = new PrismaOrgAgentEnablementStore(prisma);
    await store.setStatus("org-1", "mira", "disabled");
    expect(prisma.orgAgentEnablement.update).toHaveBeenCalledWith({
      where: { orgId_agentKey: { orgId: "org-1", agentKey: "mira" } },
      data: { status: "disabled" },
    });
  });
});
