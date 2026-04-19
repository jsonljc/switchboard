import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaCreatorIdentityStore } from "../prisma-creator-identity-store.js";

function createMockPrisma() {
  return {
    creatorIdentity: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe("PrismaCreatorIdentityStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaCreatorIdentityStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaCreatorIdentityStore(prisma as never);
  });

  describe("create", () => {
    it("creates a creator identity", async () => {
      const input = {
        deploymentId: "dep_1",
        name: "Sofia",
        identityRefIds: [],
        heroImageAssetId: "asset_hero",
        identityDescription: "Friendly lifestyle creator",
        voice: {
          voiceId: "v1",
          provider: "elevenlabs",
          tone: "warm",
          pace: "moderate",
          sampleUrl: "https://example.com/v1.mp3",
        },
        personality: { energy: "conversational", deliveryStyle: "friendly" },
        appearanceRules: { hairStates: ["down"], wardrobePalette: ["earth_tones"] },
        environmentSet: ["kitchen", "living_room"],
      };

      const expected = {
        id: "cr_1",
        ...input,
        approved: false,
        isActive: true,
        bibleVersion: "1.0",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.creatorIdentity.create.mockResolvedValue(expected);

      const result = await store.create(input);

      expect(prisma.creatorIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: "Sofia", deploymentId: "dep_1" }),
      });
      expect(result.id).toBe("cr_1");
    });
  });

  describe("findById", () => {
    it("returns creator by id", async () => {
      const creator = { id: "cr_1", name: "Sofia" };
      prisma.creatorIdentity.findUnique.mockResolvedValue(creator);

      const result = await store.findById("cr_1");
      expect(result).toEqual(creator);
    });

    it("returns null when not found", async () => {
      prisma.creatorIdentity.findUnique.mockResolvedValue(null);
      const result = await store.findById("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("findByDeployment", () => {
    it("returns active creators for a deployment", async () => {
      const creators = [{ id: "cr_1" }, { id: "cr_2" }];
      prisma.creatorIdentity.findMany.mockResolvedValue(creators);

      const result = await store.findByDeployment("dep_1");

      expect(prisma.creatorIdentity.findMany).toHaveBeenCalledWith({
        where: { deploymentId: "dep_1", isActive: true },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates creator fields", async () => {
      const updated = { id: "cr_1", name: "Sofia V2", bibleVersion: "2.0" };
      prisma.creatorIdentity.update.mockResolvedValue(updated);

      const result = await store.update("cr_1", { name: "Sofia V2", bibleVersion: "2.0" });

      expect(prisma.creatorIdentity.update).toHaveBeenCalledWith({
        where: { id: "cr_1" },
        data: { name: "Sofia V2", bibleVersion: "2.0" },
      });
      expect(result.name).toBe("Sofia V2");
    });
  });

  describe("approve", () => {
    it("sets approved to true", async () => {
      prisma.creatorIdentity.update.mockResolvedValue({ id: "cr_1", approved: true });

      const result = await store.approve("cr_1");

      expect(prisma.creatorIdentity.update).toHaveBeenCalledWith({
        where: { id: "cr_1" },
        data: { approved: true },
      });
      expect(result.approved).toBe(true);
    });
  });

  describe("deactivate", () => {
    it("sets isActive to false", async () => {
      prisma.creatorIdentity.update.mockResolvedValue({ id: "cr_1", isActive: false });

      const result = await store.deactivate("cr_1");

      expect(prisma.creatorIdentity.update).toHaveBeenCalledWith({
        where: { id: "cr_1" },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });
  });
});
