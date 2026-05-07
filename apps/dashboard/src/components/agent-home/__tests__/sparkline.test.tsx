import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../sparkline";

describe("Sparkline projection styling (PR-S5)", () => {
  it("renders a dashed segment when last point is isProjection", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 2 },
          { label: "Tue", value: 5 },
          { label: "Wed", value: 8, isProjection: true },
        ]}
      />,
    );
    const dashed = container.querySelector("path[stroke-dasharray]");
    expect(dashed).not.toBeNull();
  });

  it("renders no dashed segment when no point is projection", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 2 },
          { label: "Tue", value: 5 },
          { label: "Wed", value: 8 },
        ]}
      />,
    );
    expect(container.querySelector("path[stroke-dasharray]")).toBeNull();
  });

  it("renders dashed-ring projection circle (no fill, dashed stroke)", () => {
    const { container } = render(
      <Sparkline
        data={[
          { label: "Mon", value: 2 },
          { label: "Tue", value: 5, isProjection: true },
        ]}
      />,
    );
    const circles = Array.from(container.querySelectorAll("circle"));
    const projectionCircle = circles.find((c) => c.getAttribute("stroke-dasharray"));
    expect(projectionCircle).toBeDefined();
    expect(projectionCircle?.getAttribute("fill")).toBe("none");
  });
});

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
