import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SpriteFrame } from "../sprite-frame";
import { ALEX_VARIANTS } from "../alex-variants";

describe("<SpriteFrame>", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the AnimatedSprite SVG when the bundle/variant/state path resolves", () => {
    const { container } = render(
      <SpriteFrame
        bundle={ALEX_VARIANTS}
        variant="classic"
        state="idle"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    // Frame contains some rects from the sprite (palette has many opaque pixels).
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("falls back to the letter monogram when the variant key is missing from the bundle", () => {
    const { container, getByText } = render(
      <SpriteFrame
        bundle={ALEX_VARIANTS}
        variant="does-not-exist"
        state="idle"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("falls back to the letter monogram when the state is missing on the bundle entry", () => {
    // Construct a synthetic minimal bundle to exercise the missing-state branch
    // without mutating the real ALEX_VARIANTS bundle.
    const stub = {
      classic: {
        name: "stub",
        blurb: "stub",
        palette: { K: "#000" },
        states: { idle: [{ rows: Array(24).fill("K".repeat(24)), dur: 1000 }] },
      },
    } as unknown as typeof ALEX_VARIANTS;
    // `draft` is absent on the stub; SpriteFrame should fall back.
    const { container, getByText } = render(
      <SpriteFrame
        bundle={stub}
        variant="classic"
        state="draft"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not write to console on fallback (silent fallback per spec §8)", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <SpriteFrame
        bundle={ALEX_VARIANTS}
        variant="does-not-exist"
        state="idle"
        size={64}
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
