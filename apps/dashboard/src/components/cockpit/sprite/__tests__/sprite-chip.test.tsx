import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SpriteChip } from "../sprite-chip";
import { ALEX_VARIANTS } from "../alex-variants";

describe("<SpriteChip>", () => {
  it("renders the AnimatedSprite SVG when path resolves", () => {
    const { container } = render(
      <SpriteChip
        bundle={ALEX_VARIANTS}
        variant="classic"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to a 22px letter chip when variant is missing", () => {
    const { container, getByText } = render(
      <SpriteChip
        bundle={ALEX_VARIANTS}
        variant="nope"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("uses default size 22", () => {
    const { container } = render(
      <SpriteChip
        bundle={ALEX_VARIANTS}
        variant="classic"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("22px");
    expect(wrapper.style.height).toBe("22px");
  });

  it("falls back to the letter chip when the state is missing on the bundle entry", () => {
    const stub = {
      classic: {
        name: "stub",
        blurb: "stub",
        palette: { K: "#000" },
        states: { idle: [{ rows: Array(24).fill("K".repeat(24)), dur: 1000 }] },
      },
    } as unknown as typeof ALEX_VARIANTS;
    const { container, getByText } = render(
      <SpriteChip
        bundle={stub}
        variant="classic"
        state="draft"
        accentSoft="#F1E2C2"
        fallbackLetter="A"
      />,
    );
    expect(getByText("A")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
