import { describe, it, expect } from "vitest";
import { ModelRouter } from "@switchboard/core";
import { resolveModelRouter } from "./model-router-factory.js";

describe("resolveModelRouter", () => {
  it("returns undefined when the flag is unset (undefined)", () => {
    expect(resolveModelRouter(undefined)).toBeUndefined();
  });

  it("returns undefined when the flag is 'false'", () => {
    expect(resolveModelRouter("false")).toBeUndefined();
  });

  it("returns undefined for any non-'true' value", () => {
    expect(resolveModelRouter("1")).toBeUndefined();
    expect(resolveModelRouter("yes")).toBeUndefined();
    expect(resolveModelRouter("TRUE")).toBeUndefined();
  });

  it("returns a ModelRouter only when the flag is exactly 'true'", () => {
    expect(resolveModelRouter("true")).toBeInstanceOf(ModelRouter);
  });
});
