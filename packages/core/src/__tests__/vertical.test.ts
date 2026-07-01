import { describe, it, expect } from "vitest";
import { DEFAULT_VERTICAL, type Vertical } from "../vertical.js";

describe("vertical", () => {
  it("defaults to the medspa seed vertical (keeps existing behavior byte-identical)", () => {
    // The compile-time annotation is the real guarantee that DEFAULT_VERTICAL is a
    // Vertical member; the runtime assertion pins the seed value the loaders/scorer
    // key on. tsc enforces the union across every consumer, so no runtime list is
    // duplicated here (which would silently drift from the union).
    const seed: Vertical = DEFAULT_VERTICAL;
    expect(seed).toBe("medspa");
  });
});
