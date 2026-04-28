import { describe, expect, it } from "vitest";
import { IdentityTierSchema, ProductIdentitySchema, ProductImageSchema } from "../pcd-identity.js";

describe("IdentityTierSchema", () => {
  it("accepts 1, 2, 3", () => {
    expect(IdentityTierSchema.parse(1)).toBe(1);
    expect(IdentityTierSchema.parse(2)).toBe(2);
    expect(IdentityTierSchema.parse(3)).toBe(3);
  });

  it("rejects 0, 4, strings, null", () => {
    expect(() => IdentityTierSchema.parse(0)).toThrow();
    expect(() => IdentityTierSchema.parse(4)).toThrow();
    expect(() => IdentityTierSchema.parse("2")).toThrow();
    expect(() => IdentityTierSchema.parse(null)).toThrow();
  });
});

describe("ProductIdentitySchema", () => {
  const base = {
    id: "prd_1",
    orgId: "org_1",
    sourceUrl: "https://example.com/serum",
    title: "Hydra Serum",
    qualityTier: "url_imported" as const,
    lockStatus: "draft" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("accepts minimum URL-imported product", () => {
    expect(ProductIdentitySchema.parse(base).qualityTier).toBe("url_imported");
  });

  it("accepts canonical product with full asset pack", () => {
    const canonical = {
      ...base,
      qualityTier: "canonical" as const,
      lockStatus: "locked" as const,
      brandName: "Acme",
      sku: "AC-001",
      packageType: "bottle",
      canonicalPackageText: "Hydra Serum 30ml",
      dimensionsMm: { h: 120, w: 40, d: 40 },
      colorSpec: { primaryHex: "#0066CC", secondaryHex: "#FFFFFF" },
      logoAssetId: "asset_logo_1",
    };
    expect(ProductIdentitySchema.parse(canonical).qualityTier).toBe("canonical");
  });

  it("rejects unknown qualityTier", () => {
    expect(() => ProductIdentitySchema.parse({ ...base, qualityTier: "premium" })).toThrow();
  });
});

describe("ProductImageSchema", () => {
  it("accepts every documented viewType", () => {
    const viewTypes = [
      "hero_front",
      "back",
      "side",
      "three_quarter",
      "macro_label",
      "transparent_cutout",
      "logo",
      "fallback_scraped",
    ] as const;
    for (const viewType of viewTypes) {
      expect(
        ProductImageSchema.parse({
          id: "img_1",
          productIdentityId: "prd_1",
          viewType,
          uri: "https://cdn/x.png",
          approvedForGeneration: false,
          createdAt: new Date(),
        }).viewType,
      ).toBe(viewType);
    }
  });

  it("rejects unknown viewType", () => {
    expect(() =>
      ProductImageSchema.parse({
        id: "img_1",
        productIdentityId: "prd_1",
        viewType: "selfie",
        uri: "https://cdn/x.png",
        approvedForGeneration: false,
        createdAt: new Date(),
      }),
    ).toThrow();
  });
});
