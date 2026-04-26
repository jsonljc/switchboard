import { describe, it, expect } from "vitest";
import { generateToken, hashToken, tokenPrefix } from "../token.js";

describe("token", () => {
  it("generateToken returns a string with whk_ prefix and >=32 chars after prefix", () => {
    const t = generateToken();
    expect(t.startsWith("whk_")).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(36);
  });

  it("generateToken returns unique tokens", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(set.size).toBe(100);
  });

  it("hashToken returns deterministic 64-char hex", () => {
    const t = "whk_test123";
    const h1 = hashToken(t);
    const h2 = hashToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokenPrefix returns the first 10 chars (whk_ + 6)", () => {
    expect(tokenPrefix("whk_abcdef1234567890")).toBe("whk_abcdef");
  });
});
