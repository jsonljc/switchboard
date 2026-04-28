import { describe, expect, it } from "vitest";
import {
  IdentityTierSchema,
  ProductIdentitySchema,
  ProductImageSchema,
  ConsentRecordSchema,
  ProductQcResultSchema,
} from "../pcd-identity.js";

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

describe("ConsentRecordSchema", () => {
  it("accepts a valid consent record", () => {
    const r = ConsentRecordSchema.parse({
      id: "cr_1",
      orgId: "org_1",
      personName: "Julia Doe",
      scopeOfUse: ["paid_social", "owned_channels"],
      territory: ["US"],
      mediaTypes: ["video", "image"],
      revocable: true,
      revoked: false,
      effectiveAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(r.revoked).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(() => ConsentRecordSchema.parse({ id: "cr_1" })).toThrow();
  });
});

describe("ProductQcResultSchema", () => {
  it("accepts a pass result", () => {
    const r = ProductQcResultSchema.parse({
      id: "qc_1",
      productIdentityId: "prd_1",
      assetRecordId: "asset_1",
      passFail: "pass",
      warnings: [],
      createdAt: new Date(),
    });
    expect(r.passFail).toBe("pass");
  });

  it("accepts a fail result with scores", () => {
    expect(
      ProductQcResultSchema.parse({
        id: "qc_2",
        productIdentityId: "prd_1",
        assetRecordId: "asset_2",
        logoSimilarityScore: 0.42,
        packageOcrMatchScore: 0.6,
        passFail: "fail",
        warnings: ["ocr_mismatch", "logo_drift"],
        createdAt: new Date(),
      }).warnings.length,
    ).toBe(2);
  });
});
