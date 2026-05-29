import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportsSkeleton } from "../reports-skeleton";

describe("ReportsSkeleton", () => {
  it("renders an aria-busy loading region", () => {
    render(<ReportsSkeleton />);
    const region = screen.getByLabelText(/loading report/i);
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("aria-busy", "true");
  });

  it("renders no report numbers (purely structural placeholders)", () => {
    const { container } = render(<ReportsSkeleton />);
    expect(container.textContent).toBe("");
  });
});
