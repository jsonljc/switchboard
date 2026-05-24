import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../../../tailwind.config";

const css = readFileSync(join(__dirname, "../globals.css"), "utf8");

describe("canonical tokens — B1", () => {
  it("declares the canvas warm-cream token", () => {
    expect(css).toMatch(/--canvas:\s/);
  });

  it("declares one action color and foreground + hover", () => {
    expect(css).toMatch(/--action:\s/);
    expect(css).toMatch(/--action-foreground:\s/);
    expect(css).toMatch(/--action-hover:\s/);
  });

  it("declares three agent identity colors", () => {
    expect(css).toMatch(/--agent-alex:\s/);
    expect(css).toMatch(/--agent-riley:\s/);
    expect(css).toMatch(/--agent-mira:\s/);
  });

  it("aliases the dead mercury register to canonical vars", () => {
    expect(css).toMatch(/--mercury-cream:\s*var\(--canvas\)/);
    expect(css).toMatch(/--mercury-accent:\s*var\(/);
  });
});

describe("tailwind color keys — B2", () => {
  it("exposes action + agent identity keys", () => {
    const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;
    expect(colors.action).toBeTruthy();
    expect((colors.agent as Record<string, unknown>).alex).toBe("hsl(var(--agent-alex))");
    expect((colors.agent as Record<string, unknown>).riley).toBe("hsl(var(--agent-riley))");
    expect((colors.agent as Record<string, unknown>).mira).toBe("hsl(var(--agent-mira))");
  });

  it("keeps operator as an alias of action during migration", () => {
    const colors = (config.theme?.extend?.colors ?? {}) as Record<string, unknown>;
    const action = colors.action as Record<string, unknown>;
    const operator = colors.operator as Record<string, unknown>;
    expect(action.DEFAULT).toBeTruthy();
    expect(operator.DEFAULT).toBeTruthy();
  });
});
