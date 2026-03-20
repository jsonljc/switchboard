import { describe, it, expect } from "vitest";
import { canRequalify } from "../lifecycle.js";

describe("canRequalify", () => {
  it("allows requalification for lead stage", () => {
    expect(canRequalify("lead")).toBe(true);
  });

  it("allows requalification for qualified stage", () => {
    expect(canRequalify("qualified")).toBe(true);
  });

  it("allows requalification for churned stage", () => {
    expect(canRequalify("churned")).toBe(true);
  });

  it("blocks requalification for treated stage", () => {
    expect(canRequalify("treated")).toBe(false);
  });

  it("blocks requalification for booked stage", () => {
    expect(canRequalify("booked")).toBe(false);
  });

  it("allows requalification when stage is undefined", () => {
    expect(canRequalify(undefined)).toBe(true);
  });
});
