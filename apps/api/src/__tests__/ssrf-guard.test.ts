import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assertSafeUrl, SSRFError } from "../utils/ssrf-guard.js";
import * as dns from "node:dns/promises";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

const mockLookup = vi.mocked(dns.lookup);

describe("SSRF Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows HTTPS URLs resolving to public IPs", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as never);
    await expect(assertSafeUrl("https://example.com/webhook")).resolves.toBeUndefined();
  });

  it("rejects HTTP URLs", async () => {
    await expect(assertSafeUrl("http://example.com/webhook")).rejects.toThrow(SSRFError);
    await expect(assertSafeUrl("http://example.com/webhook")).rejects.toThrow("Only HTTPS");
  });

  it("rejects invalid URLs", async () => {
    await expect(assertSafeUrl("not-a-url")).rejects.toThrow(SSRFError);
  });

  it("rejects localhost", async () => {
    await expect(assertSafeUrl("https://localhost/webhook")).rejects.toThrow("Blocked hostname");
  });

  it("rejects cloud metadata hostname", async () => {
    await expect(assertSafeUrl("https://metadata.google.internal/computeMetadata")).rejects.toThrow(
      "Blocked hostname",
    );
  });

  it("rejects URLs resolving to 127.0.0.1", async () => {
    mockLookup.mockResolvedValue({ address: "127.0.0.1", family: 4 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects URLs resolving to 10.x.x.x", async () => {
    mockLookup.mockResolvedValue({ address: "10.0.0.1", family: 4 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects URLs resolving to 172.16.x.x", async () => {
    mockLookup.mockResolvedValue({ address: "172.16.0.1", family: 4 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects URLs resolving to 192.168.x.x", async () => {
    mockLookup.mockResolvedValue({ address: "192.168.1.1", family: 4 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects AWS metadata IP (169.254.169.254)", async () => {
    mockLookup.mockResolvedValue({ address: "169.254.169.254", family: 4 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects IPv6 loopback", async () => {
    mockLookup.mockResolvedValue({ address: "::1", family: 6 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects IPv4-mapped IPv6 private addresses", async () => {
    mockLookup.mockResolvedValue({ address: "::ffff:127.0.0.1", family: 6 } as never);
    await expect(assertSafeUrl("https://evil.example.com")).rejects.toThrow("private IP");
  });

  it("rejects when DNS resolution fails", async () => {
    mockLookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeUrl("https://nonexistent.invalid")).rejects.toThrow(
      "Could not resolve hostname",
    );
  });

  it("allows 172.15.x.x (not in private range)", async () => {
    mockLookup.mockResolvedValue({ address: "172.15.0.1", family: 4 } as never);
    await expect(assertSafeUrl("https://example.com")).resolves.toBeUndefined();
  });

  it("allows 172.32.x.x (not in private range)", async () => {
    mockLookup.mockResolvedValue({ address: "172.32.0.1", family: 4 } as never);
    await expect(assertSafeUrl("https://example.com")).resolves.toBeUndefined();
  });
});
