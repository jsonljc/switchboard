import { describe, expect, it, vi } from "vitest";
import { createPrismaPdfCacheStore } from "../prisma-pdf-cache-store.js";

describe("PrismaPdfCacheStore", () => {
  it("findByKey returns Uint8Array bytes", async () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    const prisma = {
      pdfCache: {
        findUnique: vi.fn().mockResolvedValue({
          organizationId: "org-a",
          window: "THIS MONTH",
          pdfBytes: buf,
          computedAt: new Date("2026-04-15"),
          expiresAt: new Date("2026-04-15T01:00:00Z"),
        }),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    } as unknown as Parameters<typeof createPrismaPdfCacheStore>[0];
    const store = createPrismaPdfCacheStore(prisma);
    const r = await store.findByKey("org-a", "THIS MONTH");
    expect(r?.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(r?.pdfBytes ?? [])).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("findByKey returns null when row not found", async () => {
    const prisma = {
      pdfCache: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
    } as unknown as Parameters<typeof createPrismaPdfCacheStore>[0];
    const store = createPrismaPdfCacheStore(prisma);
    expect(await store.findByKey("org-a", "THIS MONTH")).toBeNull();
  });

  it("upsert converts Uint8Array → Buffer for Prisma", async () => {
    const prisma = {
      pdfCache: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    } as unknown as Parameters<typeof createPrismaPdfCacheStore>[0];
    const store = createPrismaPdfCacheStore(prisma);
    await store.upsert({
      organizationId: "org-a",
      window: "THIS MONTH",
      pdfBytes: new Uint8Array([1, 2, 3]),
      computedAt: new Date("2026-04-15T10:00:00Z"),
      expiresAt: new Date("2026-04-15T11:00:00Z"),
    });
    const args = (prisma.pdfCache.upsert as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      create: { pdfBytes: Buffer };
    };
    expect(args.create.pdfBytes).toBeInstanceOf(Buffer);
    expect(Array.from(args.create.pdfBytes)).toEqual([1, 2, 3]);
  });

  it("invalidate calls deleteMany scoped to (orgId, window)", async () => {
    const prisma = {
      pdfCache: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as Parameters<typeof createPrismaPdfCacheStore>[0];
    const store = createPrismaPdfCacheStore(prisma);
    await store.invalidate("org-a", "THIS MONTH");
    expect(prisma.pdfCache.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", window: "THIS MONTH" },
    });
  });
});
