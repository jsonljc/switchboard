import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScopeSegment } from "../scope-segment";

describe("ScopeSegment", () => {
  it("renders Operational and All buttons with counts", () => {
    render(
      <ScopeSegment
        effectiveScope="operational"
        baseScope="operational"
        operationalCount={22}
        allCount={30}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Operational/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("highlights the base scope button via aria-pressed (not the effective scope)", () => {
    render(
      <ScopeSegment
        effectiveScope="custom"
        baseScope="all"
        operationalCount={22}
        allCount={30}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Operational/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does NOT render the Custom badge when effectiveScope is operational", () => {
    render(
      <ScopeSegment
        effectiveScope="operational"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/Custom/)).toBeNull();
  });

  it("does NOT render the Custom badge when effectiveScope is all", () => {
    render(
      <ScopeSegment
        effectiveScope="all"
        baseScope="all"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByText(/Custom/)).toBeNull();
  });

  it("renders the Custom badge with an amber dot when effectiveScope is custom", () => {
    const { container } = render(
      <ScopeSegment
        effectiveScope="custom"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/Custom/)).toBeInTheDocument();
    expect(container.querySelector("[data-testid='custom-dot']")).toBeInTheDocument();
  });

  it("Custom badge has no click handler, no role='button', and is aria-hidden", () => {
    render(
      <ScopeSegment
        effectiveScope="custom"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={() => {}}
      />,
    );
    const badge = screen.getByText(/Custom/);
    expect(badge.closest("button")).toBeNull();
    const wrapper = badge.closest("[aria-hidden='true']");
    expect(wrapper).not.toBeNull();
  });

  it("fires onChange('operational') when the Operational button is clicked", async () => {
    const onChange = vi.fn();
    render(
      <ScopeSegment
        effectiveScope="all"
        baseScope="all"
        operationalCount={0}
        allCount={0}
        onChange={onChange}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /Operational/ }));
    expect(onChange).toHaveBeenCalledWith("operational");
  });

  it("fires onChange('all') when the All button is clicked", async () => {
    const onChange = vi.fn();
    render(
      <ScopeSegment
        effectiveScope="operational"
        baseScope="operational"
        operationalCount={0}
        allCount={0}
        onChange={onChange}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: /All/ }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});
