import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { OperatorCharacter } from "./operator-character";

describe("OperatorCharacter: motion restraint (audit M6)", () => {
  it("keeps the gentle character-float", () => {
    const { container } = render(<OperatorCharacter roleFocus="growth" />);
    expect(container.querySelector(".animate-character-float")).not.toBeNull();
  });

  it("does not loop an aura-breathe idle animation (the aura is a static glow)", () => {
    const { container } = render(<OperatorCharacter roleFocus="growth" />);
    expect(container.querySelector(".animate-aura-breathe")).toBeNull();
  });

  it("still renders the static aura glow layer (only its breathing is removed)", () => {
    const { container } = render(<OperatorCharacter />);
    // the aura gradient div itself (its own rounded-full class), not the wrapper
    expect(container.querySelector(".rounded-full")).not.toBeNull();
  });
});
