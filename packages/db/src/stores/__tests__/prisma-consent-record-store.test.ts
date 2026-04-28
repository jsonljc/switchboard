import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaConsentRecordStore } from "../prisma-consent-record-store.js";

function createMockPrisma() {
  return {
    consentRecord: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaConsentRecordStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaConsentRecordStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaConsentRecordStore(prisma as never);
  });

  it("create() defaults revocable to true and forces revoked to false", async () => {
    const mockRecord = {
      id: "consent_1",
      orgId: "org_1",
      personName: "Jane Doe",
      scopeOfUse: ["marketing"],
      territory: ["US"],
      mediaTypes: ["image"],
      revocable: true,
      revoked: false,
      recordingUri: undefined,
      effectiveAt: new Date(),
      expiresAt: undefined,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.consentRecord.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecord);

    const result = await store.create({
      orgId: "org_1",
      personName: "Jane Doe",
      scopeOfUse: ["marketing"],
      territory: ["US"],
      mediaTypes: ["image"],
      effectiveAt: new Date(),
    });

    expect(result).toEqual(mockRecord);
    expect(prisma.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org_1",
        personName: "Jane Doe",
        scopeOfUse: ["marketing"],
        territory: ["US"],
        mediaTypes: ["image"],
        revocable: true,
        revoked: false,
      }),
    });
  });

  it("create() respects an explicit revocable: false input", async () => {
    const mockRecord = {
      id: "consent_2",
      orgId: "org_1",
      personName: "John Smith",
      scopeOfUse: ["analytics"],
      territory: ["EU"],
      mediaTypes: ["video"],
      revocable: false,
      revoked: false,
      recordingUri: "https://example.com/recording.mp4",
      effectiveAt: new Date(),
      expiresAt: undefined,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.consentRecord.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecord);

    const result = await store.create({
      orgId: "org_1",
      personName: "John Smith",
      scopeOfUse: ["analytics"],
      territory: ["EU"],
      mediaTypes: ["video"],
      revocable: false,
      recordingUri: "https://example.com/recording.mp4",
      effectiveAt: new Date(),
    });

    expect(result).toEqual(mockRecord);
    expect(prisma.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revocable: false,
        revoked: false,
      }),
    });
  });

  it("revoke() calls update with revoked: true and revokedAt as a Date instance", async () => {
    const revokedAt = new Date();
    const mockRecord = {
      id: "consent_1",
      orgId: "org_1",
      personName: "Jane Doe",
      scopeOfUse: ["marketing"],
      territory: ["US"],
      mediaTypes: ["image"],
      revocable: true,
      revoked: true,
      recordingUri: undefined,
      effectiveAt: new Date(),
      expiresAt: undefined,
      revokedAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updateMock = vi.fn().mockResolvedValue(mockRecord);
    prisma.consentRecord.update = updateMock;

    const result = await store.revoke("consent_1");

    expect(result).toEqual(mockRecord);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "consent_1" },
      data: expect.objectContaining({
        revoked: true,
      }),
    });
    const callArgs = updateMock.mock.calls[0]?.[0];
    expect(callArgs?.data.revokedAt).toBeInstanceOf(Date);
  });
});
