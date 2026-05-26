import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InboxFilterRow } from "../inbox-filter-row";

describe("<InboxFilterRow>", () => {
  it("renders All, Alex, and Riley chips (day-one agents always show)", () => {
    render(
      <InboxFilterRow
        counts={{ total: 5, alex: 3, riley: 2, mira: 0 }}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /All/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alex/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Riley/ })).toBeInTheDocument();
  });

  it("does NOT render the Mira chip when her count is 0", () => {
    render(
      <InboxFilterRow
        counts={{ total: 5, alex: 3, riley: 2, mira: 0 }}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /Mira/ })).toBeNull();
  });

  it("renders the Mira chip when her count is > 0", () => {
    render(
      <InboxFilterRow
        counts={{ total: 6, alex: 3, riley: 2, mira: 1 }}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Mira/ })).toBeInTheDocument();
  });

  it("calls onSelect(null) when the All chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <InboxFilterRow
        counts={{ total: 5, alex: 3, riley: 2, mira: 0 }}
        selected="alex"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /All/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onSelect('alex') when the Alex chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <InboxFilterRow
        counts={{ total: 5, alex: 3, riley: 2, mira: 0 }}
        selected={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Alex/ }));
    expect(onSelect).toHaveBeenCalledWith("alex");
  });

  it("marks the All chip aria-pressed when selected is null", () => {
    render(
      <InboxFilterRow
        counts={{ total: 5, alex: 3, riley: 2, mira: 0 }}
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Alex/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the selected agent chip aria-pressed", () => {
    render(
      <InboxFilterRow
        counts={{ total: 5, alex: 3, riley: 2, mira: 0 }}
        selected="riley"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Riley/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "false");
  });
});
