import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPages, stripHtml } from "../page-fetcher.js";

describe("stripHtml", () => {
  it("removes HTML tags and normalizes whitespace", () => {
    const html = "<h1>Hello</h1><p>World</p><script>bad();</script>";
    const result = stripHtml(html);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
    expect(result).not.toContain("<h1>");
    expect(result).not.toContain("bad()");
  });

  it("removes style tags and content", () => {
    const html = "<style>.foo { color: red; }</style><p>Content</p>";
    expect(stripHtml(html)).not.toContain("color: red");
    expect(stripHtml(html)).toContain("Content");
  });

  it("truncates to maxLength", () => {
    const html = "<p>" + "a".repeat(10000) + "</p>";
    const result = stripHtml(html, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});

describe("fetchPages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches multiple paths and returns text content", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html><body><h1>About Us</h1><p>We are great.</p></body></html>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/about"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.path).toBe("/about");
    expect(results[0]!.text).toContain("About Us");
    expect(results[0]!.rawHtml).toContain("<h1>");
  });

  it("skips pages that return non-200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/nonexistent"]);
    expect(results).toHaveLength(0);
  });

  it("skips pages that timeout", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("AbortError"));
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/slow"]);
    expect(results).toHaveLength(0);
  });

  it("never issues a request to a private/loopback base URL (SSRF guard)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<html><body><p>internal secret data behind the firewall</p></body></html>",
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("http://127.0.0.1", ["/"]);

    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("manually follows a redirect to another public URL", async () => {
    const mockFetch = vi.fn(async (url: string) => {
      if (url === "https://example.com/") {
        return {
          ok: false,
          status: 302,
          headers: new Headers({ location: "https://www.example.com/home" }),
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          "<html><body><h1>Landing</h1><p>Welcome to the real homepage.</p></body></html>",
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/"]);

    expect(results).toHaveLength(1);
    expect(results[0]!.text).toContain("Landing");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith("https://www.example.com/home", expect.anything());
  });

  it("does not follow a redirect that points at a private/metadata address", async () => {
    const internalUrl = "http://169.254.169.254/latest/meta-data/";
    const mockFetch = vi.fn(async (url: string) => {
      if (url === "https://example.com/") {
        return {
          ok: false,
          status: 302,
          headers: new Headers({ location: internalUrl }),
          text: async () => "",
        };
      }
      // Must never be reached for the internal target.
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          "<html><body><p>cloud credentials leaked from metadata service</p></body></html>",
      };
    });
    vi.stubGlobal("fetch", mockFetch);

    const results = await fetchPages("https://example.com", ["/"]);

    expect(results).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalledWith(internalUrl, expect.anything());
  });
});
