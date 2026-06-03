import { describe, it, expect } from "vitest";
import { MIRA_ACCENT, MIRA_VARIANTS, DEFAULT_MIRA_VARIANT } from "../mira-config";

describe("mira-config", () => {
  it("accent consumes the canonical violet token (identity only)", () => {
    expect(MIRA_ACCENT.base).toBe("hsl(var(--agent-mira))");
  });
  it("the default variant resolves inside the bundle (protects the avatar wiring)", () => {
    expect(MIRA_VARIANTS[DEFAULT_MIRA_VARIANT]).toBeDefined();
    expect(MIRA_VARIANTS[DEFAULT_MIRA_VARIANT].states.idle.length).toBeGreaterThan(0);
  });
});
