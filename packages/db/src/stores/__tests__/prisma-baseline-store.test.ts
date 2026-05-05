import { describe, expect, it, vi } from "vitest";
import { createPrismaBaselineStore } from "../prisma-baseline-store.js";

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
        upsert: vi.fn(),
      },
    } as unknown as Parameters<typeof createPrismaBaselineStore>[0];
    const store = createPrismaBaselineStore(prisma);
    const found = await store.listByDimension("org-a", "ads");
    expect(found).toHaveLength(1);
    expect(prisma.preSwitchboardBaseline.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", dimension: "ads" },
      orderBy: [{ metric: "asc" }, { periodStart: "asc" }],
    });
  });

  it("insertMany upserts each row by composite key", async () => {
    const prisma = {
      preSwitchboardBaseline: {
        findMany: vi.fn(),
        upsert: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Parameters<typeof createPrismaBaselineStore>[0];
    const store = createPrismaBaselineStore(prisma);
    await store.insertMany([
      {
        organizationId: "org-a",
        dimension: "ads",
        metric: "spend",
        value: 100,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-04-01T00:00:00Z"),
        capturedAt: new Date("2026-04-15T00:00:00Z"),
      },
      {
        organizationId: "org-a",
        dimension: "ads",
        metric: "leads",
        value: 50,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-04-01T00:00:00Z"),
        capturedAt: new Date("2026-04-15T00:00:00Z"),
      },
    ]);
    expect(prisma.preSwitchboardBaseline.upsert).toHaveBeenCalledTimes(2);
  });
});
