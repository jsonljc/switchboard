import { describe, it, expect } from "vitest";
import { NoOpCredentialResolver } from "../credentials/resolver.js";

describe("NoOpCredentialResolver", () => {
  it("resolve() always returns an empty object", async () => {
    const resolver = new NoOpCredentialResolver();

    const result = await resolver.resolve("digital-ads", "org_1");

    expect(result).toEqual({});
  });

  it("resolve() returns empty object regardless of arguments", async () => {
    const resolver = new NoOpCredentialResolver();

    const r1 = await resolver.resolve("payments", null);
    const r2 = await resolver.resolve("digital-ads", "org_999");
    const r3 = await resolver.resolve("", null);

    expect(r1).toEqual({});
    expect(r2).toEqual({});
    expect(r3).toEqual({});
  });

  it("resolve() returns a fresh object each time", async () => {
    const resolver = new NoOpCredentialResolver();

    const a = await resolver.resolve("x", null);
    const b = await resolver.resolve("x", null);

    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different object references
  });
});
