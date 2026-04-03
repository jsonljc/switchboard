import { describe, it, expect } from "vitest";
import { VariationPool } from "../variation-pool.js";

describe("VariationPool", () => {
  it("should return a variation control with opening style", () => {
    const pool = new VariationPool();
    const control = pool.getVariationControl("session1", "greet");
    expect(["direct", "empathetic", "curious", "light"]).toContain(control.openingStyle);
    expect(control.recentlyUsedPhrases).toEqual([]);
  });

  it("should avoid recently used styles", () => {
    const pool = new VariationPool();
    const styles = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const control = pool.getVariationControl("session1", "greet");
      styles.add(control.openingStyle);
    }
    // Should use at least 2 different styles over 10 calls
    expect(styles.size).toBeGreaterThanOrEqual(2);
  });

  it("should record and track used phrases", () => {
    const pool = new VariationPool();
    pool.recordUsed("session1", ["Hello there"]);
    pool.recordUsed("session1", ["Welcome to our business"]);

    const control = pool.getVariationControl("session1", "greet");
    expect(control.recentlyUsedPhrases).toContain("Hello there");
    expect(control.recentlyUsedPhrases).toContain("Welcome to our business");
  });

  it("should clear session data", () => {
    const pool = new VariationPool();
    pool.recordUsed("session1", ["phrase1"]);
    pool.clearSession("session1");

    const control = pool.getVariationControl("session1", "greet");
    expect(control.recentlyUsedPhrases).toEqual([]);
  });

  it("should cap stored phrases at 50", () => {
    const pool = new VariationPool();
    const phrases = Array.from({ length: 60 }, (_, i) => `phrase_${i}`);
    pool.recordUsed("session1", phrases);

    const control = pool.getVariationControl("session1", "greet");
    // Should be capped, not have all 60
    expect(control.recentlyUsedPhrases.length).toBeLessThanOrEqual(30);
  });
});
