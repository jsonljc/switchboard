import { describe, it, expect } from "vitest";

import { badgeVariants } from "../badge";

describe("badgeVariants", () => {
  it("maps `positive` to the editorial positive solid tokens (AA-designed pairing)", () => {
    const cls = badgeVariants({ variant: "positive" });
    expect(cls).toContain("bg-positive");
    expect(cls).toContain("text-positive-foreground");
    // The -subtle ground + mid-tone text pairing fails WCAG AA; use the solid pairing.
    expect(cls).not.toContain("subtle");
  });

  it("maps `caution` to the editorial caution solid tokens (AA-designed pairing)", () => {
    const cls = badgeVariants({ variant: "caution" });
    expect(cls).toContain("bg-caution");
    expect(cls).toContain("text-caution-foreground");
    expect(cls).not.toContain("subtle");
  });

  it("keeps status variants off raw Tailwind palette colors", () => {
    expect(badgeVariants({ variant: "positive" })).not.toContain("bg-green-");
    expect(badgeVariants({ variant: "caution" })).not.toContain("bg-yellow-");
  });
});
