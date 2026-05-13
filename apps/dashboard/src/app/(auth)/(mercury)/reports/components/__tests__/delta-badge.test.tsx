import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeltaBadge } from "../delta-badge";

describe("DeltaBadge", () => {
  it("renders pos with up arrow", () => {
    render(<DeltaBadge delta={{ kind: "pos", text: "↑ 22% vs Mar" }} />);
    expect(screen.getByText("↑")).toBeInTheDocument();
    expect(screen.getByText(/22% vs Mar/)).toBeInTheDocument();
  });

  it("renders neg with down arrow and no red color", () => {
    const { container } = render(<DeltaBadge delta={{ kind: "neg", text: "↓ 6% vs Q1" }} />);
    expect(screen.getByText("↓")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#f00|#ff0000|:\s*red\b/i);
  });

  it("renders flat with em-dash", () => {
    render(<DeltaBadge delta={{ kind: "flat", text: "— flat WoW" }} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("returns null for null delta", () => {
    const { container } = render(<DeltaBadge delta={null} />);
    expect(container.firstChild).toBeNull();
  });
});
