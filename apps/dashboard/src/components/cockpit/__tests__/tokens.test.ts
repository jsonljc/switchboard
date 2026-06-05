import { describe, it, expect } from "vitest";
import { T } from "../tokens";

describe("cockpit tokens are themeable (T2)", () => {
  it("every T value resolves through a CSS variable — zero literals", () => {
    for (const [key, value] of Object.entries(T)) {
      expect(value, `T.${key} must reference a CSS var()`).toMatch(/var\(--/);
      expect(value, `T.${key} must not contain a hex literal`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("maps action + status tokens to canonical semantic vars", () => {
    expect(T.amber).toBe("hsl(var(--action))");
    expect(T.green).toBe("hsl(var(--positive))");
    expect(T.red).toBe("hsl(var(--destructive))");
  });

  it("references hsl-wrapped editorial tokens bare (avoids hsl(hsl()) double-wrap)", () => {
    expect(T.ink).toBe("var(--ink)");
    expect(T.paper).toBe("hsl(var(--surface))");
  });
});
