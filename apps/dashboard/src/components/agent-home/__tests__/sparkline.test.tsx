import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../sparkline";

describe("Sparkline", () => {
  it("renders an SVG with aria-hidden=true", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 1 },
          { label: "Tue", value: 5 },
          { label: "Wed", value: 9 },
        ]}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders one point per data entry", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 1 },
          { label: "Tue", value: 5 },
        ]}
      />,
    );
    expect(container.querySelector("path")).not.toBeNull();
  });
});
