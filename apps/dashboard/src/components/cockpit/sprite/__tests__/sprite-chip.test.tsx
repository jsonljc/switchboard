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
});
