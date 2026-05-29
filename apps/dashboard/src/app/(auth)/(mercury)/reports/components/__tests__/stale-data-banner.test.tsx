import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaleDataBanner } from "../stale-data-banner";

describe("StaleDataBanner", () => {
  it("renders a status banner explaining the refresh failed", () => {
    render(<StaleDataBanner cacheAge={null} onRetry={() => {}} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument();
  });

  it("shows a minute count when cacheAge > 0", () => {
    render(<StaleDataBanner cacheAge={3} onRetry={() => {}} />);
    expect(screen.getByText(/3 min ago/i)).toBeInTheDocument();
  });

  it("says 'moments ago' when cacheAge is 0 or null", () => {
    render(<StaleDataBanner cacheAge={0} onRetry={() => {}} />);
    expect(screen.getByText(/moments ago/i)).toBeInTheDocument();
  });

  it("fires onRetry when the retry cta is clicked", async () => {
    const onRetry = vi.fn();
    render(<StaleDataBanner cacheAge={null} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
