import { describe, it, expect } from "vitest";

import { badgeVariants } from "../badge";

describe("badgeVariants", () => {
  it("maps the `positive` status variant to the editorial positive tokens (subtle)", () => {
    const cls = badgeVariants({ variant: "positive" });
    expect(cls).toContain("bg-positive-subtle");
    expect(cls).toContain("text-positive");
  });

  it("maps the `caution` status variant to the editorial caution tokens (subtle)", () => {
    const cls = badgeVariants({ variant: "caution" });
    expect(cls).toContain("bg-caution-subtle");
    expect(cls).toContain("text-caution");
  });

  it("keeps status variants off raw Tailwind palette colors", () => {
    const positive = badgeVariants({ variant: "positive" });
    const caution = badgeVariants({ variant: "caution" });
    expect(positive).not.toContain("bg-green-");
    expect(caution).not.toContain("bg-yellow-");
  });
});
