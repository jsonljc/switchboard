import { describe, it, expect } from "vitest";
import { detectPlatform } from "../platform-detector.js";

describe("detectPlatform", () => {
  it("detects Shopify from meta tag", () => {
    const html = '<html><head><meta name="shopify-digital-wallet" content="true"></head></html>';
    expect(detectPlatform(html)).toBe("shopify");
  });

  it("detects Shopify from CDN URL", () => {
    const html = '<html><head><link href="//cdn.shopify.com/s/files/theme.css"></head></html>';
    expect(detectPlatform(html)).toBe("shopify");
  });

  it("detects WordPress from generator meta", () => {
    const html = '<html><head><meta name="generator" content="WordPress 6.4"></head></html>';
    expect(detectPlatform(html)).toBe("wordpress");
  });

  it("detects WordPress from wp-content path", () => {
    const html = '<html><body><img src="/wp-content/uploads/logo.png"></body></html>';
    expect(detectPlatform(html)).toBe("wordpress");
  });

  it("detects Wix from meta generator", () => {
    const html =
      '<html><head><meta name="generator" content="Wix.com Website Builder"></head></html>';
    expect(detectPlatform(html)).toBe("wix");
  });

  it("detects Squarespace from script", () => {
    const html =
      '<html><body><script src="https://static1.squarespace.com/static/ta/script.js"></script></body></html>';
    expect(detectPlatform(html)).toBe("squarespace");
  });

  it("returns undefined for custom/unknown sites", () => {
    const html = "<html><head><title>My Site</title></head><body>Hello</body></html>";
    expect(detectPlatform(html)).toBeUndefined();
  });

  it("handles empty HTML", () => {
    expect(detectPlatform("")).toBeUndefined();
  });
});
