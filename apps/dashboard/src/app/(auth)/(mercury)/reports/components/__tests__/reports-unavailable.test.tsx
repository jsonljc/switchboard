import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsUnavailable } from "../reports-unavailable";

describe("ReportsUnavailable", () => {
  it("renders an alert with a temporarily-unavailable message", () => {
    render(<ReportsUnavailable onRetry={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
  });

  it("does not reuse empty-state 'all clear' copy", () => {
    const { container } = render(<ReportsUnavailable onRetry={() => {}} />);
    expect(container.textContent).not.toMatch(/all clear|nothing to show|no reports yet/i);
  });

  it("fires onRetry when Try again is clicked", async () => {
    const onRetry = vi.fn();
    render(<ReportsUnavailable onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
