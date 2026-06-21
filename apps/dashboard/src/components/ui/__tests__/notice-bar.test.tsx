import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoticeBar } from "../notice-bar";

describe("NoticeBar", () => {
  it("renders children inside a passive status strip (never an alert)", () => {
    render(<NoticeBar>Heads up</NoticeBar>);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the semantic caution tint + AA-safe ink, not raw amber", () => {
    // text-caution on caution-subtle is only ~4.4:1 (fails AA), so the tint
    // carries the tone and dark --foreground ink carries the text (~15:1).
    render(<NoticeBar tone="caution">Demo data mode</NoticeBar>);
    const strip = screen.getByRole("status");
    expect(strip.className).toContain("bg-caution-subtle");
    expect(strip.className).toContain("text-foreground");
    expect(strip.className).not.toMatch(/amber/);
  });

  it("forwards pass-through props (title, className)", () => {
    render(
      <NoticeBar title="Live systems are not being queried." className="extra-class">
        Demo data mode
      </NoticeBar>,
    );
    const strip = screen.getByRole("status");
    expect(strip.getAttribute("title")).toMatch(/live systems/i);
    expect(strip.className).toContain("extra-class");
  });
});
