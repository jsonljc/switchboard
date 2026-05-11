import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterChips, type StageFilter } from "../filter-chips";

describe("FilterChips", () => {
  it("renders the locked lifecycle-only chip set — no Booked", () => {
    render(<FilterChips active={null} onChange={() => {}} />);
    for (const label of ["All", "New", "Active", "Customer", "Retained", "Dormant"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Booked" })).toBeNull();
  });

  it("marks exactly one chip pressed at a time", () => {
    render(<FilterChips active="active" onChange={() => {}} />);
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("Active");
  });

  it("treats `null` as the All chip", () => {
    render(<FilterChips active={null} onChange={() => {}} />);
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("All");
  });

  it("emits the correct value when a chip is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(next: StageFilter) => void>();
    render(<FilterChips active="active" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Customer" }));
    expect(onChange).toHaveBeenCalledWith("customer");

    await user.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("clicking an already-active chip is a no-op", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips active="active" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
