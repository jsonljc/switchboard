import { describe, it, expect } from "vitest";

import { buttonVariants } from "../button";

describe("buttonVariants", () => {
  it("maps the amber `action` variant to the single-source action tokens", () => {
    const cls = buttonVariants({ variant: "action" });
    // Editorial register: amber is the ONLY action color (see globals.css --action).
    expect(cls).toContain("bg-action");
    expect(cls).toContain("text-action-foreground");
    expect(cls).toContain("hover:bg-action-hover");
  });

  it("leaves the neutral `default` variant on the ink primary tokens", () => {
    const cls = buttonVariants({ variant: "default" });
    expect(cls).toContain("bg-primary");
    expect(cls).not.toContain("bg-action");
  });
});
