import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterChips } from "../components/filter-chips";

const counts = { all: 101, active: 12, fired: 83, cancelled: 4, expired: 2 };

describe("<FilterChips />", () => {
  it("renders all 5 chips with counts and marks Active as default-selected", () => {
    render(<FilterChips active={"active"} counts={counts} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Active 12/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /Fired 83/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /All 101/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelled 4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Expired 2/ })).toBeInTheDocument();
  });

  it("calls onChange with 'all' when the All chip is clicked", () => {
    const onChange = vi.fn();
    render(<FilterChips active={"active"} counts={counts} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /All 101/ }));
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("calls onChange with the chosen status on click", () => {
    const onChange = vi.fn();
    render(<FilterChips active={"active"} counts={counts} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Fired 83/ }));
    expect(onChange).toHaveBeenCalledWith("fired");
  });

  it("only one chip is aria-pressed at a time", () => {
    render(<FilterChips active={"fired"} counts={counts} onChange={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveTextContent(/Fired 83/);
  });
});
