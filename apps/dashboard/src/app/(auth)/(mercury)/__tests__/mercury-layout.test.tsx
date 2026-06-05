import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import MercuryLayout from "../layout";

afterEach(cleanup);

describe("MercuryLayout (the register marker)", () => {
  it("renders a hidden mercury register marker alongside children, never wrapping them", () => {
    const { container, getByText } = render(
      <MercuryLayout>
        <p>mercury content</p>
      </MercuryLayout>,
    );
    const marker = container.querySelector('[data-register="mercury"]');
    expect(marker).not.toBeNull();
    expect(marker!.hasAttribute("hidden")).toBe(true);
    expect(marker!.childElementCount).toBe(0);
    const content = getByText("mercury content");
    expect(marker!.contains(content)).toBe(false);
  });
});
