import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterChips } from "../components/filter-chips.js";

describe("FilterChips", () => {
  it("renders both Operational and All events chips", () => {
    render(<FilterChips scope="operational" onChipChange={() => {}} onClearFilters={() => {}} />);
    expect(screen.getByRole("button", { name: "Operational" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All events" })).toBeInTheDocument();
  });

  it("marks Operational as pressed when scope=operational", () => {
    render(<FilterChips scope="operational" onChipChange={() => {}} onClearFilters={() => {}} />);
    expect(screen.getByRole("button", { name: "Operational" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "All events" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("marks All events as pressed when scope=all", () => {
    render(<FilterChips scope="all" onChipChange={() => {}} onClearFilters={() => {}} />);
    expect(screen.getByRole("button", { name: "All events" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Operational" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("clicking All events calls onChipChange('all')", async () => {
    const user = userEvent.setup();
    const onChipChange = vi.fn();
    render(
      <FilterChips scope="operational" onChipChange={onChipChange} onClearFilters={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "All events" }));
    expect(onChipChange).toHaveBeenCalledWith("all");
  });

  it("clicking Operational calls onChipChange('operational') when not already selected", async () => {
    const user = userEvent.setup();
    const onChipChange = vi.fn();
    render(<FilterChips scope="all" onChipChange={onChipChange} onClearFilters={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Operational" }));
    expect(onChipChange).toHaveBeenCalledWith("operational");
  });

  it("clicking the already-active chip is a no-op", async () => {
    const user = userEvent.setup();
    const onChipChange = vi.fn();
    render(
      <FilterChips scope="operational" onChipChange={onChipChange} onClearFilters={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Operational" }));
    expect(onChipChange).not.toHaveBeenCalled();
  });

  it("shows the [Filtered · Clear] pill when scope=custom", () => {
    render(<FilterChips scope="custom" onChipChange={() => {}} onClearFilters={() => {}} />);
    // The pill contains a Clear button
    expect(screen.getByRole("button", { name: /Clear active filters/ })).toBeInTheDocument();
    // The text "Filtered" appears in the pill
    expect(screen.getByText("Filtered")).toBeInTheDocument();
  });

  it("does NOT show the Filtered pill when scope=operational", () => {
    render(<FilterChips scope="operational" onChipChange={() => {}} onClearFilters={() => {}} />);
    expect(screen.queryByRole("button", { name: /Clear active filters/ })).toBeNull();
    expect(screen.queryByText("Filtered")).toBeNull();
  });

  it("does NOT show the Filtered pill when scope=all", () => {
    render(<FilterChips scope="all" onChipChange={() => {}} onClearFilters={() => {}} />);
    expect(screen.queryByRole("button", { name: /Clear active filters/ })).toBeNull();
  });

  it("clicking Clear on the Filtered pill calls onClearFilters", async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    render(<FilterChips scope="custom" onChipChange={() => {}} onClearFilters={onClearFilters} />);
    await user.click(screen.getByRole("button", { name: /Clear active filters/ }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("Operational chip is visually selected when scope=custom (intent preserved)", () => {
    render(<FilterChips scope="custom" onChipChange={() => {}} onClearFilters={() => {}} />);
    // Operational is pressed (default intent when scope=custom)
    expect(screen.getByRole("button", { name: "Operational" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // All events is not pressed
    expect(screen.getByRole("button", { name: "All events" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("chips have accessible role=button and aria-pressed", () => {
    render(<FilterChips scope="operational" onChipChange={() => {}} onClearFilters={() => {}} />);
    const operational = screen.getByRole("button", { name: "Operational" });
    const allEvents = screen.getByRole("button", { name: "All events" });
    expect(operational).toHaveAttribute("aria-pressed");
    expect(allEvents).toHaveAttribute("aria-pressed");
  });

  it("nav has aria-label for screen readers", () => {
    render(<FilterChips scope="operational" onChipChange={() => {}} onClearFilters={() => {}} />);
    expect(screen.getByRole("navigation", { name: /Filter activity/i })).toBeInTheDocument();
  });
});
