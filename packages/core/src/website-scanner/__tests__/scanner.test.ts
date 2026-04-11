import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebsiteScanner } from "../scanner.js";
import { MockLLMClient } from "../../llm/types.js";
import type { ScannedBusinessProfile } from "@switchboard/schemas";

const VALID_PROFILE: ScannedBusinessProfile = {
  businessName: "Test Bakery",
  description: "A test bakery",
  products: [{ name: "Bread", description: "Fresh bread" }],
  services: ["Catering"],
  faqs: [{ question: "Hours?", answer: "9-5" }],
  brandLanguage: ["artisan", "fresh"],
};

describe("WebsiteScanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("scans a website and returns a validated profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "<html><body><h1>Test Bakery</h1><p>We bake bread.</p></body></html>",
      }),
    );

    const llm = new MockLLMClient([JSON.stringify(VALID_PROFILE)]);
    const scanner = new WebsiteScanner(llm);

    const result = await scanner.scan("https://testbakery.com");

    expect(result.businessName).toBe("Test Bakery");
    expect(result.products).toHaveLength(1);
    expect(result.brandLanguage).toContain("artisan");
  });

  it("rejects invalid URLs (SSRF prevention)", async () => {
    const llm = new MockLLMClient();
    const scanner = new WebsiteScanner(llm);

    await expect(scanner.scan("file:///etc/passwd")).rejects.toThrow("Invalid URL scheme");
    await expect(scanner.scan("http://127.0.0.1")).rejects.toThrow("IP addresses not allowed");
  });

  it("includes detected platform in the profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          '<html><head><meta name="shopify-digital-wallet" content="true"></head><body><h1>Welcome to our Shopify store</h1><p>Browse our products and find something you love.</p></body></html>',
      }),
    );

    const profileWithPlatform = { ...VALID_PROFILE, platformDetected: "shopify" as const };
    const llm = new MockLLMClient([JSON.stringify(profileWithPlatform)]);
    const scanner = new WebsiteScanner(llm);

    const result = await scanner.scan("https://shop.example.com");
    expect(result.platformDetected).toBe("shopify");
  });

  it("handles sites where all pages fail gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const llm = new MockLLMClient([JSON.stringify(VALID_PROFILE)]);
    const scanner = new WebsiteScanner(llm);

    await expect(scanner.scan("https://dead-site.com")).rejects.toThrow(
      "Could not fetch any pages",
    );
  });
});
