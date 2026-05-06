import { describe, expect, it, vi } from "vitest";
import { PrismaReportCacheStore } from "../prisma-report-cache-store.js";
import type { ReportDataV1 } from "@switchboard/schemas";
import type { PrismaDbClient } from "../../prisma-db.js";

const sample: ReportDataV1 = {
  label: "THIS MONTH",
  period: "x",
  dateFolio: "x",
  pullquote: { pre: "", value: "", mid: "", cost: "", post: "" },
  attribution: {
    total: 0,
    delta: { kind: "flat", text: "" },
    riley: { value: 0, caption: "" },
    alex: { value: 0, caption: "" },
  },
  funnel: [],
  funnelNarrative: { marker: "", text: "" },
  campaigns: [],
  cost: { paid: 0, alt: 0, saving: 0 },
  costNarrative: "",
  managedComparison: null,
};

describe("PrismaReportCacheStore", () => {
  it("findByKey maps a Prisma row to ReportCacheRow", async () => {
    const computedAt = new Date("2026-04-15T10:00:00Z");
    const expiresAt = new Date("2026-04-15T11:00:00Z");
    const prisma = {
      reportCache: {
        findUnique: vi.fn().mockResolvedValue({
          organizationId: "org-a",
          window: "THIS MONTH",
          payload: sample,
          computedAt,
          expiresAt,
        }),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    } as unknown as PrismaDbClient;

    const store = new PrismaReportCacheStore(prisma);
    const found = await store.findByKey("org-a", "THIS MONTH");
    expect(found).toEqual({
      organizationId: "org-a",
      window: "THIS MONTH",
      payload: sample,
      computedAt,
      expiresAt,
    });
    expect(prisma.reportCache.findUnique).toHaveBeenCalledWith({
      where: { organizationId_window: { organizationId: "org-a", window: "THIS MONTH" } },
    });
  });

  it("findByKey returns null when row not found", async () => {
    const prisma = {
      reportCache: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    } as unknown as PrismaDbClient;
    const store = new PrismaReportCacheStore(prisma);
    expect(await store.findByKey("org-a", "THIS MONTH")).toBeNull();
  });

  it("upsert calls Prisma upsert with correct args", async () => {
    const prisma = {
      reportCache: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockResolvedValue(null),
        deleteMany: vi.fn(),
      },
    } as unknown as PrismaDbClient;
    const store = new PrismaReportCacheStore(prisma);
    const computedAt = new Date();
    const expiresAt = new Date(computedAt.getTime() + 3600_000);
    await store.upsert({
      organizationId: "org-a",
      window: "THIS MONTH",
      payload: sample,
      computedAt,
      expiresAt,
    });
    expect(prisma.reportCache.upsert).toHaveBeenCalledWith({
      where: { organizationId_window: { organizationId: "org-a", window: "THIS MONTH" } },
      create: {
        organizationId: "org-a",
        window: "THIS MONTH",
        payload: sample,
        computedAt,
        expiresAt,
      },
      update: { payload: sample, computedAt, expiresAt },
    });
  });

  it("invalidate calls deleteMany scoped to (orgId, window)", async () => {
    const prisma = {
      reportCache: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as PrismaDbClient;
    const store = new PrismaReportCacheStore(prisma);
    await store.invalidate("org-a", "THIS MONTH");
    expect(prisma.reportCache.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", window: "THIS MONTH" },
    });
  });
});
