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
      const r = result as { valid: boolean; validatedUrl: string };
      expect(r.valid).toBe(true);
      expect(r.validatedUrl).toBe("https://example.com/");
    });

    it("rejects non-HTTP URLs", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "ftp://example.com" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).valid).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).error).toContain("scheme");
    });

    it("rejects empty string", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).valid).toBe(false);
    });

    it("rejects URLs with credentials", async () => {
      const result = await tool.operations["validate-url"]!.execute({
        url: "https://user:pass@example.com",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).valid).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).error).toContain("credentials");
    });

    it("rejects IP address hostnames", async () => {
      const result = await tool.operations["validate-url"]!.execute({ url: "https://127.0.0.1" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).valid).toBe(false);
    });
  });

  describe("detect-platform", () => {
    it("detects Shopify", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<link rel="stylesheet" href="//cdn.shopify.com/s/files/1/theme.css">',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).platform).toBe("shopify");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).confidence).toBe("regex-match");
    });

    it("detects WordPress", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: '<meta name="generator" content="WordPress 6.4">',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).platform).toBe("wordpress");
    });

    it("returns null for unrecognized HTML", async () => {
      const result = await tool.operations["detect-platform"]!.execute({
        html: "<html><body>Hello</body></html>",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).platform).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result as any).confidence).toBe("none");
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
      const r = result as { structuredData: unknown[] };
      expect(r.structuredData).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((r.structuredData[0] as any).name).toBe("Test Biz");
    });

    it("extracts Open Graph meta tags", async () => {
      const html = `<html><head>
        <meta property="og:title" content="My Business">
        <meta property="og:description" content="We do things">
      </head><body></body></html>`;
      const result = await tool.operations["extract-business-info"]!.execute({ html });
      const r = result as { openGraph: Record<string, string> };
      expect(r.openGraph["og:title"]).toBe("My Business");
    });

    it("returns empty results for plain HTML", async () => {
      const result = await tool.operations["extract-business-info"]!.execute({
        html: "<html><body>Hello</body></html>",
      });
      const r = result as { structuredData: unknown[]; openGraph: Record<string, string> };
      expect(r.structuredData).toHaveLength(0);
      expect(Object.keys(r.openGraph)).toHaveLength(0);
    });
  });
});
