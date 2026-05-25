import { describe, expect, it } from "vitest";
import { canSwipeApprove, needsConfirm } from "../swipe-policy";

const base = {
  riskLevel: "low",
  externalEffect: false,
  financialEffect: false,
  clientFacing: false,
  requiresConfirmation: false,
} as const;

describe("canSwipeApprove", () => {
  it("returns true for a fully low-risk contract", () => {
    expect(canSwipeApprove(base)).toBe(true);
  });

  it("returns false when financialEffect is true", () => {
    expect(canSwipeApprove({ ...base, financialEffect: true })).toBe(false);
  });

  it("returns false when clientFacing is true", () => {
    expect(canSwipeApprove({ ...base, clientFacing: true })).toBe(false);
  });

  it("returns false when externalEffect is true", () => {
    expect(canSwipeApprove({ ...base, externalEffect: true })).toBe(false);
  });

  it("returns false when riskLevel is medium", () => {
    expect(canSwipeApprove({ ...base, riskLevel: "medium" })).toBe(false);
  });

  it("returns false when contract is undefined (missing = unsafe)", () => {
    expect(canSwipeApprove(undefined)).toBe(false);
  });
});

describe("needsConfirm", () => {
  it("returns true when requiresConfirmation is true", () => {
    expect(needsConfirm({ ...base, requiresConfirmation: true })).toBe(true);
  });

  it("returns true when riskLevel is high", () => {
    expect(needsConfirm({ ...base, riskLevel: "high" })).toBe(true);
  });

  it("returns false for a fully low-risk contract with no confirmation flag", () => {
    expect(needsConfirm(base)).toBe(false);
  });

  it("returns true when contract is undefined (missing = needs confirm)", () => {
    expect(needsConfirm(undefined)).toBe(true);
  });
});
