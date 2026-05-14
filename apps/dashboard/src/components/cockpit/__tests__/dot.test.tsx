// apps/dashboard/src/components/cockpit/__tests__/dot.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Dot } from "../dot.js";

describe("Dot", () => {
  it("renders a single dot with the given color (no pulse layer)", () => {
    const { container } = render(<Dot color="#3F7A36" />);
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(2); // wrapper + filled dot
  });

  it("renders the pulse layer when pulse=true", () => {
    const { container } = render(<Dot color="#B8782E" pulse />);
    const spans = container.querySelectorAll("span");
    expect(spans.length).toBe(3); // wrapper + pulse + filled dot
  });

  it("honors a custom size", () => {
    const { container } = render(<Dot color="#A03A2E" size={9} />);
    const wrapper = container.querySelector("span") as HTMLSpanElement;
    expect(wrapper.style.width).toBe("9px");
    expect(wrapper.style.height).toBe("9px");
  });
});
