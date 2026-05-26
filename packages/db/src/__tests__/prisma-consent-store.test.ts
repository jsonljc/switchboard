import { describe, it, expect, vi } from "vitest";
import { createPrismaConsentStore } from "../prisma-consent-store.js";

const buildPrisma = (
  overrides: Partial<{
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  }> = {},
) =>
  ({
    contact: {
      findUnique: overrides.findUnique ?? vi.fn(),
      findFirst: overrides.findFirst ?? vi.fn(),
      update: overrides.update ?? vi.fn(),
      updateMany: overrides.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("createPrismaConsentStore", () => {
  it("setJurisdictionIfNull writes when current jurisdiction is null", async () => {
    const update = vi.fn();
    const prisma = buildPrisma({
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update,
    });
    const store = createPrismaConsentStore({ prisma });
    await store.setJurisdictionIfNull("c1", "SG", "org1");
    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", organizationId: "org1", pdpaJurisdiction: null },
      data: { pdpaJurisdiction: "SG" },
    });
  });

  it("setRevocationIfNotRevoked reports wasNewlyRevoked=true when count=1", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ consentRevokedAt: null }) // pre-check
      .mockResolvedValueOnce({ consentRevokedAt: new Date("2026-05-10") }); // post-read
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = buildPrisma({ findUnique, updateMany });
    const store = createPrismaConsentStore({ prisma });

    const result = await store.setRevocationIfNotRevoked({
      contactId: "c1",
      revokedAt: new Date("2026-05-10"),
      source: "inbound_keyword_revocation",
      actor: "system:inbound_keyword_revocation",
      organizationId: "org1",
    });
    expect(result.wasNewlyRevoked).toBe(true);
  });

  it("setRevocationIfNotRevoked reports wasNewlyRevoked=false when row already revoked", async () => {
    const existing = new Date("2026-05-09");
    const findFirst = vi.fn().mockResolvedValue({ consentRevokedAt: existing });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = buildPrisma({ findFirst, updateMany });
    const store = createPrismaConsentStore({ prisma });

    const result = await store.setRevocationIfNotRevoked({
      contactId: "c1",
      revokedAt: new Date("2026-05-10"),
      source: "inbound_keyword_revocation",
      actor: "system:inbound_keyword_revocation",
      organizationId: "org1",
    });
    expect(result.wasNewlyRevoked).toBe(false);
    expect(result.existingRevokedAt).toEqual(existing);
  });
});
