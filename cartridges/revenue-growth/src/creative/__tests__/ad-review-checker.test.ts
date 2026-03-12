import { describe, it, expect } from "vitest";
import { AdReviewChecker, type CreativeAssetForReview } from "../ad-review-checker.js";
import { InMemoryAccountProfileStore } from "../../stores/in-memory.js";

describe("AdReviewChecker", () => {
  const checker = new AdReviewChecker();

  describe("prohibited content", () => {
    it("flags guaranteed claims", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a1",
          type: "text",
          textContent: "Guaranteed results in 30 days!",
        },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.violations).toContainEqual(
        expect.objectContaining({ code: "PROHIBITED_GUARANTEE" }),
      );
    });

    it("flags get-rich-quick language", () => {
      const assets: CreativeAssetForReview[] = [
        { id: "a2", type: "text", textContent: "Make money fast with this one trick" },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.passed).toBe(false);
      expect(results[0]!.violations).toContainEqual(
        expect.objectContaining({ code: "PROHIBITED_GET_RICH" }),
      );
    });

    it("flags health claims", () => {
      const assets: CreativeAssetForReview[] = [
        { id: "a3", type: "text", textContent: "This product can cure your condition" },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.passed).toBe(false);
    });

    it("flags before-and-after claims", () => {
      const assets: CreativeAssetForReview[] = [
        { id: "a4", type: "text", textContent: "See the before and after transformation" },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.violations).toContainEqual(
        expect.objectContaining({ code: "PROHIBITED_BEFORE_AFTER" }),
      );
    });

    it("passes clean ad copy", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a5",
          type: "text",
          textContent: "Discover our new collection — shop now and save 20%",
        },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.passed).toBe(true);
      expect(results[0]!.violations).toHaveLength(0);
    });
  });

  describe("text-to-image ratio", () => {
    it("warns when text ratio exceeds 20%", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a6",
          type: "image",
          textContent: "Lots of text overlay",
          textToImageRatio: 0.35,
        },
      ];

      const results = checker.checkBatch(assets);
      const ratioViolation = results[0]!.violations.find((v) => v.code === "TEXT_RATIO_EXCEEDED");
      expect(ratioViolation).toBeDefined();
      expect(ratioViolation!.severity).toBe("warning");
    });

    it("passes when text ratio is within limit", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a7",
          type: "image",
          textContent: "Minimal text",
          textToImageRatio: 0.15,
        },
      ];

      const results = checker.checkBatch(assets);
      const ratioViolation = results[0]!.violations.find((v) => v.code === "TEXT_RATIO_EXCEEDED");
      expect(ratioViolation).toBeUndefined();
    });

    it("skips text ratio check for non-image assets", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a8",
          type: "video",
          textContent: "Video ad",
          textToImageRatio: 0.5,
        },
      ];

      const results = checker.checkBatch(assets);
      const ratioViolation = results[0]!.violations.find((v) => v.code === "TEXT_RATIO_EXCEEDED");
      expect(ratioViolation).toBeUndefined();
    });

    it("checks carousel assets for text ratio", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a9",
          type: "carousel",
          textContent: "Carousel text",
          textToImageRatio: 0.3,
        },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.violations).toContainEqual(
        expect.objectContaining({ code: "TEXT_RATIO_EXCEEDED" }),
      );
    });
  });

  describe("landing page validation", () => {
    it("flags non-HTTPS landing pages", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a10",
          type: "text",
          textContent: "Click here",
          landingPageUrl: "http://example.com",
        },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.violations).toContainEqual(
        expect.objectContaining({ code: "LANDING_PAGE_NOT_HTTPS" }),
      );
    });

    it("flags invalid URLs", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a11",
          type: "text",
          textContent: "Visit us",
          landingPageUrl: "not-a-url",
        },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.violations).toContainEqual(
        expect.objectContaining({ code: "LANDING_PAGE_INVALID_URL" }),
      );
    });

    it("passes valid HTTPS landing pages", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "a12",
          type: "text",
          textContent: "Shop now",
          landingPageUrl: "https://shop.example.com/products",
        },
      ];

      const results = checker.checkBatch(assets);
      const urlViolation = results[0]!.violations.find((v) => v.code.startsWith("LANDING_PAGE"));
      expect(urlViolation).toBeUndefined();
    });
  });

  describe("batch processing", () => {
    it("processes multiple assets", () => {
      const assets: CreativeAssetForReview[] = [
        { id: "b1", type: "text", textContent: "Clean copy here" },
        { id: "b2", type: "text", textContent: "Guaranteed results!" },
        { id: "b3", type: "text", textContent: "Another clean ad" },
      ];

      const results = checker.checkBatch(assets);
      expect(results).toHaveLength(3);
      expect(results[0]!.passed).toBe(true);
      expect(results[1]!.passed).toBe(false);
      expect(results[2]!.passed).toBe(true);
    });

    it("returns correct assetIds", () => {
      const assets: CreativeAssetForReview[] = [
        { id: "x1", type: "text", textContent: "Test" },
        { id: "x2", type: "text", textContent: "Test" },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.assetId).toBe("x1");
      expect(results[1]!.assetId).toBe("x2");
    });
  });

  describe("logRejections", () => {
    it("handles empty results without error", async () => {
      const store = new InMemoryAccountProfileStore();
      await expect(checker.logRejections([], store)).resolves.toBeUndefined();
    });

    it("handles missing store gracefully", async () => {
      const results = checker.checkBatch([{ id: "r1", type: "text", textContent: "Guaranteed!" }]);
      await expect(checker.logRejections(results)).resolves.toBeUndefined();
    });
  });

  describe("warning-only violations still pass", () => {
    it("passes when only warnings (no errors)", () => {
      const assets: CreativeAssetForReview[] = [
        {
          id: "w1",
          type: "image",
          textContent: "Clean copy",
          textToImageRatio: 0.25,
        },
      ];

      const results = checker.checkBatch(assets);
      expect(results[0]!.passed).toBe(true); // Only warning, not error
      expect(results[0]!.violations).toHaveLength(1);
    });
  });
});
