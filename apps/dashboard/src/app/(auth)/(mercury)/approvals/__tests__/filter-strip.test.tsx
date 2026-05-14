import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterStrip } from "../components/filter-strip";

const counts = { all: 12, low: 4, medium: 3, high: 4, critical: 1 };

describe("FilterStrip", () => {
  it("renders one chip per risk level plus 'all'", () => {
    render(
      <FilterStrip
        filter="all"
        expiringOnly={false}
        counts={counts}
        expiringSoonCount={3}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^low/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^medium/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^high/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^critical/i })).toBeInTheDocument();
  });

  it("renders the expiring-soon chip", () => {
    render(
      <FilterStrip
        filter="all"
        expiringOnly={false}
        counts={counts}
        expiringSoonCount={3}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /expiring/i })).toBeInTheDocument();
  });

  it("invokes onChange with the next filter on chip click", () => {
    const onChange = vi.fn();
    render(
      <FilterStrip
        filter="all"
        expiringOnly={false}
        counts={counts}
        expiringSoonCount={3}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^high/i }));
    expect(onChange).toHaveBeenCalledWith({ filter: "high", expiringOnly: false });
  });

  it("invokes onChange with toggled expiringOnly", () => {
    const onChange = vi.fn();
    render(
      <FilterStrip
        filter="all"
        expiringOnly={false}
        counts={counts}
        expiringSoonCount={3}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expiring/i }));
    expect(onChange).toHaveBeenCalledWith({ filter: "all", expiringOnly: true });
  });
});
