import { describe, expect, it } from "vitest";
import { IdentityTierSchema } from "../pcd-identity.js";

describe("IdentityTierSchema", () => {
  it("accepts 1, 2, 3", () => {
    expect(IdentityTierSchema.parse(1)).toBe(1);
    expect(IdentityTierSchema.parse(2)).toBe(2);
    expect(IdentityTierSchema.parse(3)).toBe(3);
  });

  it("rejects 0, 4, strings, null", () => {
    expect(() => IdentityTierSchema.parse(0)).toThrow();
    expect(() => IdentityTierSchema.parse(4)).toThrow();
    expect(() => IdentityTierSchema.parse("2")).toThrow();
    expect(() => IdentityTierSchema.parse(null)).toThrow();
  });
});
