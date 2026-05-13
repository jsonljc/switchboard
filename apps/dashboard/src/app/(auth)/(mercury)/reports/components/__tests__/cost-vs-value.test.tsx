import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostVsValue } from "../cost-vs-value";

const baseProps = {
  cost: { paid: 612, alt: 8000, saving: 7388 },
  narrative: "vs. an SDR + agency retainer.",
};

describe("CostVsValue", () => {
  it("renders 'Salesperson + ad agency' label (not 'SDR + agency alt.')", () => {
    render(<CostVsValue {...baseProps} />);
    expect(screen.getByText(/Salesperson \+ ad agency/i)).toBeInTheDocument();
    expect(screen.queryByText(/SDR \+ agency alt/i)).toBeNull();
  });

  it("renders You pay, Salesperson+, Monthly saving cells", () => {
    render(<CostVsValue {...baseProps} />);
    expect(screen.getByText(/You pay/i)).toBeInTheDocument();
    expect(screen.getByText(/Monthly saving/i)).toBeInTheDocument();
  });

  it("renders the saving with S$ prefix", () => {
    const { container } = render(<CostVsValue {...baseProps} />);
    expect(container.textContent).toContain("S$7,388");
  });

  it("alt cell has strikethrough class", () => {
    const { container } = render(<CostVsValue {...baseProps} />);
    expect(container.querySelector('[class*="alt"]')).toBeTruthy();
  });

  it("never emits a bare $", () => {
    const { container } = render(<CostVsValue {...baseProps} />);
    expect(container.textContent).not.toMatch(/(?<!S)\$/);
  });
});
