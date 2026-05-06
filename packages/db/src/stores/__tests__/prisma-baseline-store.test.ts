import { describe, expect, it, vi } from "vitest";
import { PrismaBaselineStore } from "../prisma-baseline-store.js";
import type { PrismaDbClient } from "../../prisma-db.js";

describe("PrismaBaselineStore", () => {
  it("listByDimension returns rows scoped to (orgId, dimension)", async () => {
    const rows = [
      {
        organizationId: "org-a",
        dimension: "ads",
        metric: "spend",
        value: 100,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-04-01T00:00:00Z"),
        capturedAt: new Date("2026-04-15T00:00:00Z"),
      },
    ];
    const prisma = {
      preSwitchboardBaseline: {
        findMany: vi.fn().mockResolvedValue(rows),
        createMany: vi.fn(),
      },
    } as unknown as PrismaDbClient;
    const store = new PrismaBaselineStore(prisma);
    const found = await store.listByDimension("org-a", "ads");
    expect(found).toHaveLength(1);
    expect(prisma.preSwitchboardBaseline.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", dimension: "ads" },
      orderBy: { periodStart: "asc" },
    });
  });

  it("insertMany uses createMany with skipDuplicates", async () => {
    const prisma = {
      preSwitchboardBaseline: {
        findMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaDbClient;
    const store = new PrismaBaselineStore(prisma);
    const periodStart = new Date("2026-01-01T00:00:00Z");
    const periodEnd = new Date("2026-04-01T00:00:00Z");
    await store.insertMany([
      {
        organizationId: "org-a",
        dimension: "ads",
        metric: "spend",
        value: 100,
        periodStart,
        periodEnd,
        capturedAt: new Date("2026-04-15T00:00:00Z"),
      },
    ]);
    expect(prisma.preSwitchboardBaseline.createMany).toHaveBeenCalledWith({
      data: [
        {
          organizationId: "org-a",
          dimension: "ads",
          metric: "spend",
          value: 100,
          periodStart,
          periodEnd,
          capturedAt: expect.any(Date),
        },
      ],
      skipDuplicates: true,
    });
  });
});
