import { describe, it, expect } from "vitest";
import { shortHash } from "../short-hash";

describe("shortHash", () => {
  it("returns slice(0,6) + ellipsis + slice(-3) for a typical hash", () => {
    expect(shortHash("0x2f1a08c4e9b1d7a4f0c3b8a5d2e7f1a9")).toBe("0x2f1a…1a9");
  });
  it("returns empty string for empty input", () => {
    expect(shortHash("")).toBe("");
  });
  it("returns empty string for null/undefined", () => {
    expect(shortHash(undefined)).toBe("");
    expect(shortHash(null)).toBe("");
  });
  it("returns the full string when length <= 9", () => {
    expect(shortHash("0xabcd")).toBe("0xabcd");
    expect(shortHash("012345678")).toBe("012345678");
  });
});
