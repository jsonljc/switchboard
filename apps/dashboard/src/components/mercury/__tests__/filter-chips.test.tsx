import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterChips, type FilterChipItem } from "../filter-chips";

type Stage = "all" | "new" | "active";

const ITEMS: ReadonlyArray<FilterChipItem<Stage>> = [
  { key: "all", label: "All", value: "all" },
  { key: "new", label: "New", value: "new" },
  { key: "active", label: "Active", value: "active" },
];

describe("Mercury <FilterChips />", () => {
  it("renders one button per item with the supplied label", () => {
    render(
      <FilterChips items={ITEMS} active="all" onChange={() => {}} ariaLabel="Filter by stage" />,
    );
    for (const label of ["All", "New", "Active"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("wraps the chips in a nav landmark with the supplied aria-label", () => {
    render(
      <FilterChips items={ITEMS} active="all" onChange={() => {}} ariaLabel="Filter by stage" />,
    );
    expect(screen.getByRole("navigation", { name: "Filter by stage" })).toBeInTheDocument();
  });

  it("marks exactly one chip aria-pressed=true at a time", () => {
    render(<FilterChips items={ITEMS} active="active" onChange={() => {}} ariaLabel="x" />);
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("Active");
  });

  it("emits onChange with the chip's value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(next: Stage) => void>();
    render(<FilterChips items={ITEMS} active="all" onChange={onChange} ariaLabel="x" />);

    await user.click(screen.getByRole("button", { name: "New" }));
    expect(onChange).toHaveBeenCalledWith("new");

    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(onChange).toHaveBeenLastCalledWith("active");
  });

  it("clicking the active chip does not emit onChange (no-op)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterChips items={ITEMS} active="active" onChange={onChange} ariaLabel="x" />);
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports nullable active values (treats null as a valid identity)", () => {
    type Maybe = string | null;
    const items: ReadonlyArray<FilterChipItem<Maybe>> = [
      { key: "all", label: "All", value: null },
      { key: "x", label: "X", value: "x" },
    ];
    render(<FilterChips items={items} active={null} onChange={() => {}} ariaLabel="x" />);
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("All");
  });

  it("uses a custom isEqual when supplied", () => {
    type Pair = { a: number };
    const items: ReadonlyArray<FilterChipItem<Pair>> = [
      { key: "1", label: "One", value: { a: 1 } },
      { key: "2", label: "Two", value: { a: 2 } },
    ];
    // Object identity differs but isEqual matches by `.a`.
    render(
      <FilterChips
        items={items}
        active={{ a: 2 }}
        onChange={() => {}}
        ariaLabel="x"
        isEqual={(x, y) => x.a === y.a}
      />,
    );
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("Two");
  });

  it("isPressed override controls aria-pressed independently of `active`", () => {
    render(
      <FilterChips
        items={ITEMS}
        active="all"
        onChange={() => {}}
        ariaLabel="x"
        // Force "active" to be visually pressed even though `active` is "all".
        isPressed={(item) => item.value === "active"}
      />,
    );
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });

  it("suppressActiveClick=false forwards onChange even when chip is pressed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(next: Stage) => void>();
    render(
      <FilterChips
        items={ITEMS}
        active="active"
        onChange={onChange}
        ariaLabel="x"
        suppressActiveClick={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Active" }));
    expect(onChange).toHaveBeenCalledWith("active");
  });

  it("accepts an extra trailing slot for surface-specific adornments (e.g. Filtered pill)", () => {
    render(
      <FilterChips
        items={ITEMS}
        active="all"
        onChange={() => {}}
        ariaLabel="x"
        trailing={<span data-testid="trailing">extra</span>}
      />,
    );
    expect(screen.getByTestId("trailing")).toBeInTheDocument();
    // Trailing content lives inside the same nav landmark.
    const nav = screen.getByRole("navigation");
    expect(nav.contains(screen.getByTestId("trailing"))).toBe(true);
  });
});
