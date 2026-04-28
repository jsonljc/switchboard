import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaProductIdentityStore } from "../prisma-product-identity-store.js";

function createMockPrisma() {
  return {
    productIdentity: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    productImage: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe("PrismaProductIdentityStore", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let store: PrismaProductIdentityStore;

  beforeEach(() => {
    prisma = createMockPrisma();
    store = new PrismaProductIdentityStore(prisma as never);
  });

  it("create() defaults qualityTier to 'url_imported' and lockStatus to 'draft'", async () => {
    const mockProduct = {
      id: "prod_1",
      orgId: "org_1",
      title: "Test Product",
      qualityTier: "url_imported",
      lockStatus: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.productIdentity.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockProduct);

    const result = await store.create({ orgId: "org_1", title: "Test Product" });

    expect(result).toEqual(mockProduct);
    expect(prisma.productIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org_1",
        title: "Test Product",
        qualityTier: "url_imported",
        lockStatus: "draft",
      }),
    });
  });

  it("getById() calls findUnique with the correct WHERE clause", async () => {
    const mockProduct = {
      id: "prod_42",
      orgId: "org_1",
      title: "Found Product",
      qualityTier: "url_imported",
      lockStatus: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.productIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockProduct);

    const result = await store.getById("prod_42");

    expect(result).toEqual(mockProduct);
    expect(prisma.productIdentity.findUnique).toHaveBeenCalledWith({
      where: { id: "prod_42" },
    });
  });

  it("addImage() passes productIdentityId and required fields to productImage.create", async () => {
    const mockImage = {
      id: "img_1",
      productIdentityId: "prod_1",
      viewType: "hero_front",
      uri: "https://example.com/image.jpg",
      approvedForGeneration: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (prisma.productImage.create as ReturnType<typeof vi.fn>).mockResolvedValue(mockImage);

    const result = await store.addImage("prod_1", {
      viewType: "hero_front",
      uri: "https://example.com/image.jpg",
      approvedForGeneration: true,
    });

    expect(result).toEqual(mockImage);
    expect(prisma.productImage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productIdentityId: "prod_1",
        viewType: "hero_front",
        uri: "https://example.com/image.jpg",
        approvedForGeneration: true,
      }),
    });
  });

  it("listImages() calls findMany with correct where and orderBy", async () => {
    const mockImages = [
      {
        id: "img_1",
        productIdentityId: "prod_1",
        viewType: "front",
        uri: "https://example.com/front.jpg",
        approvedForGeneration: true,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date(),
      },
      {
        id: "img_2",
        productIdentityId: "prod_1",
        viewType: "back",
        uri: "https://example.com/back.jpg",
        approvedForGeneration: false,
        createdAt: new Date("2026-01-02"),
        updatedAt: new Date(),
      },
    ];
    (prisma.productImage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockImages);

    const result = await store.listImages("prod_1");

    expect(result).toHaveLength(2);
    expect(prisma.productImage.findMany).toHaveBeenCalledWith({
      where: { productIdentityId: "prod_1" },
      orderBy: { createdAt: "asc" },
    });
  });
});
