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

  it("aliases the dead mercury register to canonical vars as VALID colors", () => {
    // --mercury-* tokens are consumed as complete color values (e.g.
    // `background: var(--mercury-cream)`), so any alias to a raw canonical
    // HSL triple MUST be hsl()-wrapped. Aliasing bare (`var(--canvas)`) emits
    // `background: 40 25% 94%` — invalid CSS that silently breaks the
    // contacts/activity/automations surfaces. Guard against that regression.
    expect(css).toMatch(/--mercury-cream:\s*hsl\(var\(--canvas\)\)/);
    expect(css).not.toMatch(/--mercury-[\w-]+:\s*var\(--/);
  });
});

describe("Home warm-operational-editorial tokens — P1-A", () => {
  it("declares the supporting canvas zones as complete (hsl-wrapped) colors", () => {
    // --canvas-2/3 are consumed bare (e.g. `background: var(--canvas-2)`), so
    // they must carry a complete hsl() value, not a raw triple.
    expect(css).toMatch(/--canvas-2:\s*hsl\(/);
    expect(css).toMatch(/--canvas-3:\s*hsl\(/);
  });

  it("per-agent deep + tint identity reference --palette-* primitives", () => {
    // After token unification (T1) these alias --palette-* primitives; the raw
    // triple lives only in the primitive block. Must NOT be hsl-wrapped here, or
    // `hsl(var(--agent-alex-deep))` would double-wrap to hsl(hsl(...)).
    for (const t of [
      "agent-alex-deep",
      "agent-alex-tint",
      "agent-riley-deep",
      "agent-riley-tint",
      "agent-mira-deep",
      "agent-mira-tint",
    ]) {
      expect(css).toMatch(new RegExp(`--${t}:\\s*var\\(--palette-`));
      expect(css).not.toMatch(new RegExp(`--${t}:\\s*hsl\\(`));
    }
  });

  it("declares the Home shadow + easing scale", () => {
    expect(css).toMatch(/--shadow-card:\s/);
    expect(css).toMatch(/--shadow-lift:\s/);
    expect(css).toMatch(/--shadow-sheet:\s/);
    expect(css).toMatch(/--ease-home:\s/);
  });

  it("declares the Home editorial font stacks", () => {
    expect(css).toMatch(/--font-home-sans:\s*var\(--font-hanken\)/);
    expect(css).toMatch(/--font-home-serif:\s*var\(--font-newsreader\)/);
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
