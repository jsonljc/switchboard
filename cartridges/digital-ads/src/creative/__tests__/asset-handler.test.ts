import { describe, it, expect, beforeEach } from "vitest";
import { CreativeAssetRegistry } from "../asset-handler.js";
import type { CreativeAsset } from "../asset-handler.js";

function makeAsset(overrides?: Partial<CreativeAsset>): CreativeAsset {
  return {
    id: `asset_${Math.random().toString(36).slice(2, 8)}`,
    organizationId: "org_1",
    fileName: "hero.jpg",
    mimeType: "image/jpeg",
    url: "https://cdn.example.com/hero.jpg",
    sizeBytes: 200_000,
    width: 1080,
    height: 1080,
    tags: ["whitening", "smile"],
    serviceIds: ["svc_whitening"],
    type: "image",
    source: "onboarding",
    approved: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("CreativeAssetRegistry", () => {
  let registry: CreativeAssetRegistry;

  beforeEach(() => {
    registry = new CreativeAssetRegistry();
  });

  describe("add / get / remove", () => {
    it("stores and retrieves an asset by ID", () => {
      const asset = makeAsset({ id: "a1" });
      registry.add(asset);

      expect(registry.get("a1")).toBe(asset);
    });

    it("returns undefined for unknown ID", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("removes an asset by ID", () => {
      const asset = makeAsset({ id: "a1" });
      registry.add(asset);

      expect(registry.remove("a1")).toBe(true);
      expect(registry.get("a1")).toBeUndefined();
    });

    it("returns false when removing a non-existent asset", () => {
      expect(registry.remove("nonexistent")).toBe(false);
    });
  });

  describe("listByOrganization", () => {
    it("returns only assets belonging to the given org", () => {
      registry.add(makeAsset({ id: "a1", organizationId: "org_1" }));
      registry.add(makeAsset({ id: "a2", organizationId: "org_2" }));
      registry.add(makeAsset({ id: "a3", organizationId: "org_1" }));

      const result = registry.listByOrganization("org_1");
      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(expect.arrayContaining(["a1", "a3"]));
    });

    it("returns empty array for unknown org", () => {
      expect(registry.listByOrganization("org_unknown")).toEqual([]);
    });
  });

  describe("selectForCampaign", () => {
    it("scores service match highest (+40)", () => {
      registry.add(makeAsset({ id: "match", serviceIds: ["svc_whitening"] }));
      registry.add(makeAsset({ id: "no_match", serviceIds: ["svc_cleaning"] }));

      const results = registry.selectForCampaign("org_1", { serviceId: "svc_whitening" });

      expect(results[0]!.asset.id).toBe("match");
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it("scores tag matches (+10 per tag)", () => {
      registry.add(makeAsset({ id: "two_tags", tags: ["whitening", "smile"] }));
      registry.add(makeAsset({ id: "one_tag", tags: ["whitening"] }));
      registry.add(makeAsset({ id: "no_tags", tags: ["unrelated"] }));

      const results = registry.selectForCampaign("org_1", {
        tags: ["whitening", "smile"],
      });

      expect(results[0]!.asset.id).toBe("two_tags");
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    });

    it("scores type match (+20)", () => {
      registry.add(makeAsset({ id: "video", type: "video" }));
      registry.add(makeAsset({ id: "image", type: "image" }));

      const results = registry.selectForCampaign("org_1", { type: "video" });

      const videoResult = results.find((r) => r.asset.id === "video");
      const imageResult = results.find((r) => r.asset.id === "image");
      expect(videoResult!.score).toBeGreaterThan(imageResult!.score);
    });

    it("gives default image preference when no type specified (+10)", () => {
      registry.add(makeAsset({ id: "img", type: "image", serviceIds: [] }));
      registry.add(makeAsset({ id: "vid", type: "video", serviceIds: [] }));

      const results = registry.selectForCampaign("org_1", {});

      const imgResult = results.find((r) => r.asset.id === "img");
      const vidResult = results.find((r) => r.asset.id === "vid");
      expect(imgResult!.score).toBeGreaterThan(vidResult!.score);
    });

    it("scores resolution match (+5 each for width and height)", () => {
      registry.add(makeAsset({ id: "hires", width: 1920, height: 1080 }));
      registry.add(makeAsset({ id: "lowres", width: 400, height: 300 }));

      const results = registry.selectForCampaign("org_1", {
        minWidth: 1000,
        minHeight: 1000,
      });

      const hiresResult = results.find((r) => r.asset.id === "hires");
      const lowresResult = results.find((r) => r.asset.id === "lowres");
      expect(hiresResult!.score).toBeGreaterThan(lowresResult!.score);
    });

    it("scores aspect ratio match (+20)", () => {
      registry.add(makeAsset({ id: "square", width: 1080, height: 1080 }));
      registry.add(makeAsset({ id: "wide", width: 1920, height: 1080 }));

      const results = registry.selectForCampaign("org_1", { aspectRatio: "1:1" });

      const squareResult = results.find((r) => r.asset.id === "square");
      const wideResult = results.find((r) => r.asset.id === "wide");
      expect(squareResult!.score).toBeGreaterThan(wideResult!.score);
    });

    it("excludes unapproved assets", () => {
      registry.add(makeAsset({ id: "approved", approved: true }));
      registry.add(makeAsset({ id: "pending", approved: false }));

      const results = registry.selectForCampaign("org_1", {});

      expect(results.every((r) => r.asset.approved)).toBe(true);
    });

    it("limits results to maxResults", () => {
      for (let i = 0; i < 10; i++) {
        registry.add(makeAsset({ id: `a${i}` }));
      }

      const results = registry.selectForCampaign("org_1", {}, 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("sorts results by score descending", () => {
      registry.add(makeAsset({ id: "low", serviceIds: [], tags: [] }));
      registry.add(
        makeAsset({
          id: "high",
          serviceIds: ["svc_whitening"],
          tags: ["whitening", "smile"],
        }),
      );

      const results = registry.selectForCampaign("org_1", {
        serviceId: "svc_whitening",
        tags: ["whitening", "smile"],
      });

      expect(results[0]!.asset.id).toBe("high");
    });

    it("includes match reasons", () => {
      registry.add(
        makeAsset({
          id: "a1",
          serviceIds: ["svc_whitening"],
          tags: ["whitening"],
          width: 1080,
          height: 1080,
        }),
      );

      const results = registry.selectForCampaign("org_1", {
        serviceId: "svc_whitening",
        tags: ["whitening"],
        aspectRatio: "1:1",
      });

      expect(results[0]!.matchReasons.length).toBeGreaterThan(0);
      expect(results[0]!.matchReasons.some((r) => r.includes("service"))).toBe(true);
    });

    it("handles case-insensitive tag matching", () => {
      registry.add(makeAsset({ id: "a1", tags: ["Whitening", "SMILE"] }));

      const results = registry.selectForCampaign("org_1", {
        tags: ["whitening", "smile"],
      });

      expect(results[0]!.score).toBeGreaterThanOrEqual(20); // 10 per tag
    });
  });

  describe("getAssetCounts", () => {
    it("counts images, videos, and total", () => {
      registry.add(makeAsset({ id: "img1", type: "image" }));
      registry.add(makeAsset({ id: "img2", type: "image" }));
      registry.add(makeAsset({ id: "vid1", type: "video" }));

      const counts = registry.getAssetCounts("org_1");
      expect(counts).toEqual({ images: 2, videos: 1, total: 3 });
    });

    it("returns zeros for empty org", () => {
      const counts = registry.getAssetCounts("org_empty");
      expect(counts).toEqual({ images: 0, videos: 0, total: 0 });
    });
  });

  describe("aspect ratio detection", () => {
    it("detects common aspect ratios via selectForCampaign", () => {
      const ratios: Array<{ w: number; h: number; label: string }> = [
        { w: 1080, h: 1080, label: "1:1" },
        { w: 1920, h: 1080, label: "16:9" },
        { w: 1080, h: 1920, label: "9:16" },
        { w: 1080, h: 1350, label: "4:5" },
      ];

      for (const { w, h, label } of ratios) {
        const reg = new CreativeAssetRegistry();
        reg.add(makeAsset({ id: `ar_${label}`, width: w, height: h }));

        const results = reg.selectForCampaign("org_1", { aspectRatio: label });
        expect(
          results[0]!.matchReasons.some((r) => r.includes("aspect ratio")),
          `Expected ${label} (${w}x${h}) to match`,
        ).toBe(true);
      }
    });
  });
});
