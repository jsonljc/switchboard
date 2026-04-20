import { describe, it, expect } from "vitest";
import { createWebScannerTool } from "./web-scanner.js";

describe("web-scanner tool", () => {
  const tool = createWebScannerTool();

  it("has correct id", () => {
    expect(tool.id).toBe("web-scanner");
  });

  it("has 4 operations", () => {
    expect(Object.keys(tool.operations)).toEqual([
      "validate-url",
      "fetch-pages",
      "detect-platform",
      "extract-business-info",
    ]);
  });

  it("all operations have effectCategory read", () => {
    for (const op of Object.values(tool.operations)) {
      expect(op.effectCategory).toBe("read");
    }
  });

  describe("validate-url", () => {
    it("validates a well-formed HTTPS URL", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "https://example.com",
      });
      expect(result.status).toBe("success");
      expect(result.data?.valid).toBe(true);
      expect(result.data?.validatedUrl).toBe("https://example.com/");
    });

    it("rejects non-HTTP URLs", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "ftp://example.com" });
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_INPUT");
      expect(result.error?.message).toContain("scheme");
    });

    it("rejects empty string", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "" });
      expect(result.status).toBe("error");
      expect(result.error?.code).toBe("INVALID_INPUT");
    });

    it("rejects URLs with credentials", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "https://user:pass@example.com",
      });
      expect(result.status).toBe("error");
      expect(result.error?.message).toContain("credentials");
    });

    it("rejects IP address hostnames", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "https://127.0.0.1" });
      expect(result.status).toBe("error");
    });
  });

  describe("detect-platform", () => {
    it("detects Shopify", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<link rel="stylesheet" href="//cdn.shopify.com/s/files/1/theme.css">',
      });
      expect(result.status).toBe("success");
      expect(result.data?.platform).toBe("shopify");
      expect(result.data?.confidence).toBe("regex-match");
    });

    it("detects WordPress", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<meta name="generator" content="WordPress 6.4">',
      });
      expect(result.status).toBe("success");
      expect(result.data?.platform).toBe("wordpress");
    });

    it("returns null for unrecognized HTML", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: "<html><body>Hello</body></html>",
      });
      expect(result.status).toBe("success");
      expect(result.data?.platform).toBeNull();
      expect(result.data?.confidence).toBe("none");
    });
  });

  describe("extract-business-info", () => {
    it("extracts JSON-LD structured data", async () => {
      const html = `<html><head>
        <script type="application/ld+json">
        {"@type": "LocalBusiness", "name": "Test Biz", "telephone": "+1234"}
        </script>
      </head><body></body></html>`;
      const result = await tool.operations["extract-business-info"]!.execute({ html });
      expect(result.status).toBe("success");
      const structuredData = result.data?.structuredData as unknown[];
      expect(structuredData).toHaveLength(1);
      expect((structuredData[0] as Record<string, unknown>).name).toBe("Test Biz");
    });

    it("extracts Open Graph meta tags", async () => {
      const html = `<html><head>
        <meta property="og:title" content="My Business">
        <meta property="og:description" content="We do things">
      </head><body></body></html>`;
      const result = await tool.operations["extract-business-info"]!.execute({ html });
      expect(result.status).toBe("success");
      const openGraph = result.data?.openGraph as Record<string, string>;
      expect(openGraph["og:title"]).toBe("My Business");
    });

    it("returns empty results for plain HTML", async () => {
      const result = await tool.operations["extract-business-info"]!.execute({
        html: "<html><body>Hello</body></html>",
      });
      expect(result.status).toBe("success");
      expect(result.data?.structuredData as unknown[]).toHaveLength(0);
      expect(Object.keys(result.data?.openGraph as Record<string, string>)).toHaveLength(0);
    });
  });
});
