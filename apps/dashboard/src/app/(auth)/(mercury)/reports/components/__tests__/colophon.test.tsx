import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Colophon } from "../colophon";

const baseProps = {
  period: "APR 1 — APR 30",
  org: "Aurora Aesthetics",
  generatedAt: new Date("2026-05-09T09:14:22+08:00"),
  liveMode: false,
};

describe("Colophon", () => {
  it("renders the period", () => {
    render(<Colophon {...baseProps} />);
    expect(screen.getByText("APR 1 — APR 30")).toBeInTheDocument();
  });

  it("renders 'Sample data' mode pip when liveMode false", () => {
    render(<Colophon {...baseProps} liveMode={false} />);
    expect(screen.getByText(/Sample data/i)).toBeInTheDocument();
  });

  it("renders 'Live data' mode pip when liveMode true", () => {
    render(<Colophon {...baseProps} liveMode={true} />);
    expect(screen.getByText(/Live data/i)).toBeInTheDocument();
  });

  it("renders the org name", () => {
    render(<Colophon {...baseProps} />);
    expect(screen.getByText("Aurora Aesthetics")).toBeInTheDocument();
  });

  it("never renders the developer schema label", () => {
    const { container } = render(<Colophon {...baseProps} />);
    expect(container.textContent).not.toMatch(/schema\s*·\s*reports/i);
    expect(container.textContent).not.toMatch(/reports\/v1/);
  });
});
