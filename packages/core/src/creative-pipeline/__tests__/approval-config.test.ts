import { describe, it, expect } from "vitest";
import { shouldRequireApproval } from "../ugc/approval-config.js";

describe("shouldRequireApproval", () => {
  it("requires approval for planning when trust < 55", () => {
    expect(
      shouldRequireApproval({ phase: "planning", trustLevel: 30, deploymentType: "standard" }),
    ).toBe(true);
  });

  it("skips approval for planning when trust >= 55", () => {
    expect(
      shouldRequireApproval({ phase: "planning", trustLevel: 55, deploymentType: "standard" }),
    ).toBe(false);
  });

  it("requires approval for production when trust < 80", () => {
    expect(
      shouldRequireApproval({ phase: "production", trustLevel: 70, deploymentType: "standard" }),
    ).toBe(true);
  });

  it("skips approval for production when trust >= 80", () => {
    expect(
      shouldRequireApproval({ phase: "production", trustLevel: 80, deploymentType: "standard" }),
    ).toBe(false);
  });

  it("requires approval for delivery when trust < 80", () => {
    expect(
      shouldRequireApproval({ phase: "delivery", trustLevel: 79, deploymentType: "standard" }),
    ).toBe(true);
  });

  it("skips approval for delivery when trust >= 80", () => {
    expect(
      shouldRequireApproval({ phase: "delivery", trustLevel: 80, deploymentType: "standard" }),
    ).toBe(false);
  });

  it("always requires approval for zero trust", () => {
    expect(
      shouldRequireApproval({ phase: "planning", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
    expect(
      shouldRequireApproval({ phase: "scripting", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
    expect(
      shouldRequireApproval({ phase: "production", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
    expect(
      shouldRequireApproval({ phase: "delivery", trustLevel: 0, deploymentType: "standard" }),
    ).toBe(true);
  });
});
