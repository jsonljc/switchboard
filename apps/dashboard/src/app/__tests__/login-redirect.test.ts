import { describe, it, expect } from "vitest";
import { defaultCallback } from "../login/redirect-logic";

describe("defaultCallback", () => {
  it("returns /onboarding when session has no organizationId", () => {
    expect(defaultCallback(null)).toBe("/onboarding");
    expect(defaultCallback({ user: { id: "u" } } as never)).toBe("/onboarding");
  });

  it("returns /onboarding when session has organizationId but onboardingComplete is false", () => {
    expect(
      defaultCallback({
        user: { id: "u" },
        organizationId: "org-1",
        onboardingComplete: false,
      } as never),
    ).toBe("/onboarding");
  });

  it("returns /console when session is fully onboarded", () => {
    expect(
      defaultCallback({
        user: { id: "u" },
        organizationId: "org-1",
        onboardingComplete: true,
      } as never),
    ).toBe("/console");
  });
});
