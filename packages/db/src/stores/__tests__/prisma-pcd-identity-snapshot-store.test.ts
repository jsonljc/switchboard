import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaPcdIdentitySnapshotStore } from "../prisma-pcd-identity-snapshot-store.js";

function createMockPrisma() {
  return {
    pcdIdentitySnapshot: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  };
}

describe("PrismaPcdIdentitySnapshotStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaPcdIdentitySnapshotStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaPcdIdentitySnapshotStore(prisma as never);
  });

  it("create() writes the full snapshot input to prisma.pcdIdentitySnapshot.create", async () => {
    const mockSnapshot = {
      id: "snap_1",
      assetRecordId: "asset_1",
      productIdentityId: "prod_id_1",
      productTierAtGeneration: 2 as const,
      productImageAssetIds: ["image_1", "image_2"],
      productCanonicalTextHash: "hash_abc123",
      productLogoAssetId: "logo_1",
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 1 as const,
      avatarReferenceAssetIds: ["avatar_ref_1"],
      voiceAssetId: "voice_1",
      consentRecordId: "consent_1",
      policyVersion: "1.0",
      providerCapabilityVersion: "2.1",
      selectedProvider: "openai",
      providerModelSnapshot: '{"model":"gpt-4","temp":0.7}',
      seedOrNoSeed: "seed",
      rewrittenPromptText: "rewritten prompt",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.pcdIdentitySnapshot.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockSnapshot);

    const result = await store.create({
      assetRecordId: "asset_1",
      productIdentityId: "prod_id_1",
      productTierAtGeneration: 2,
      productImageAssetIds: ["image_1", "image_2"],
      productCanonicalTextHash: "hash_abc123",
      productLogoAssetId: "logo_1",
      creatorIdentityId: "creator_1",
      avatarTierAtGeneration: 1,
      avatarReferenceAssetIds: ["avatar_ref_1"],
      voiceAssetId: "voice_1",
      consentRecordId: "consent_1",
      policyVersion: "1.0",
      providerCapabilityVersion: "2.1",
      selectedProvider: "openai",
      providerModelSnapshot: '{"model":"gpt-4","temp":0.7}',
      seedOrNoSeed: "seed",
      rewrittenPromptText: "rewritten prompt",
    });

    expect(result).toEqual(mockSnapshot);
    expect(prisma.pcdIdentitySnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assetRecordId: "asset_1",
        productIdentityId: "prod_id_1",
        productTierAtGeneration: 2,
        avatarTierAtGeneration: 1,
        selectedProvider: "openai",
        providerModelSnapshot: '{"model":"gpt-4","temp":0.7}',
      }),
    });
  });

  it("getByAssetRecordId() calls findUnique with where: { assetRecordId } and returns the result", async () => {
    const mockSnapshot = {
      id: "snap_2",
      assetRecordId: "asset_2",
      productIdentityId: "prod_id_2",
      productTierAtGeneration: 3 as const,
      productImageAssetIds: ["image_3"],
      productCanonicalTextHash: "hash_def456",
      productLogoAssetId: null,
      creatorIdentityId: "creator_2",
      avatarTierAtGeneration: 2 as const,
      avatarReferenceAssetIds: ["avatar_ref_2", "avatar_ref_3"],
      voiceAssetId: null,
      consentRecordId: null,
      policyVersion: "2.0",
      providerCapabilityVersion: "3.0",
      selectedProvider: "anthropic",
      providerModelSnapshot: '{"model":"claude-3","temp":0.5}',
      seedOrNoSeed: "no-seed",
      rewrittenPromptText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.pcdIdentitySnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockSnapshot,
    );

    const result = await store.getByAssetRecordId("asset_2");

    expect(result).toEqual(mockSnapshot);
    expect(prisma.pcdIdentitySnapshot.findUnique).toHaveBeenCalledWith({
      where: { assetRecordId: "asset_2" },
    });
  });

  it("getByAssetRecordId() returns null when nothing is found", async () => {
    (prisma.pcdIdentitySnapshot.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await store.getByAssetRecordId("nonexistent_asset");

    expect(result).toBeNull();
    expect(prisma.pcdIdentitySnapshot.findUnique).toHaveBeenCalledWith({
      where: { assetRecordId: "nonexistent_asset" },
    });
  });
});
