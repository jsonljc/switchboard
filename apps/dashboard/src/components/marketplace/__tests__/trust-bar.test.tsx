import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustBar } from "../trust-bar";

describe("TrustBar", () => {
  it("renders 10 segments with correct fill count for score 47", () => {
    render(<TrustBar score={47} />);
    const segments = screen.getAllByTestId(/^segment-/);
    expect(segments).toHaveLength(10);

    const filled = segments.filter((seg) => seg.getAttribute("data-filled") === "true");
    expect(filled).toHaveLength(5);
  });

  it("renders score number", () => {
    render(<TrustBar score={47} />);
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("renders delta when provided", () => {
    const { rerender } = render(<TrustBar score={47} delta={3} />);
    expect(screen.getByText("+3")).toBeInTheDocument();

    rerender(<TrustBar score={47} delta={-5} />);
    expect(screen.getByText("-5")).toBeInTheDocument();
  });

  it("renders 0 filled for score 0", () => {
    render(<TrustBar score={0} />);
    const segments = screen.getAllByTestId(/^segment-/);
    const filled = segments.filter((seg) => seg.getAttribute("data-filled") === "true");
    expect(filled).toHaveLength(0);
  });

  it("renders 10 filled for score 100", () => {
    render(<TrustBar score={100} />);
    const segments = screen.getAllByTestId(/^segment-/);
    const filled = segments.filter((seg) => seg.getAttribute("data-filled") === "true");
    expect(filled).toHaveLength(10);
  });
});
