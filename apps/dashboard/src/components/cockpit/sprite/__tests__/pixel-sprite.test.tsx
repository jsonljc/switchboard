import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PixelSprite } from "../pixel-sprite";
import type { Palette, Frame } from "../types";

const PAL: Palette = { K: "#000000", S: "#ff0000" };

// Build a tiny test frame: top-left pixel = K, next = S, rest transparent.
function makeFrame(): Frame {
  const blank = ".".repeat(24);
  const top = "KS" + blank.substring(2);
  return [top, ...Array(23).fill(blank)];
}

describe("<PixelSprite>", () => {
  it("renders one <rect> per non-transparent pixel using the palette color", () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size={48} />);
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(2);
    expect(rects[0].getAttribute("fill")).toBe("#000000");
    expect(rects[1].getAttribute("fill")).toBe("#ff0000");
  });

  it("emits an svg with viewBox 0 0 24 24 and crispEdges rendering", () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg?.getAttribute("width")).toBe("48");
    expect(svg?.getAttribute("height")).toBe("48");
  });

  it("treats palette keys not in the palette object as transparent (skipped)", () => {
    const partial: Palette = { K: "#000000" }; // S deliberately missing
    const { container } = render(<PixelSprite rows={makeFrame()} palette={partial} size={48} />);
    const rects = container.querySelectorAll("rect");
    expect(rects).toHaveLength(1); // S skipped because not in palette
    expect(rects[0].getAttribute("fill")).toBe("#000000");
  });

  it("is aria-hidden by default (decorative)", () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it('renders percentage dimensions in "fill" mode (fluid hero scale)', () => {
    const { container } = render(<PixelSprite rows={makeFrame()} palette={PAL} size="fill" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("100%");
    expect(svg?.getAttribute("height")).toBe("100%");
    // The viewBox still pins the 24x24 grid so pixels scale crisply.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
  });
});
