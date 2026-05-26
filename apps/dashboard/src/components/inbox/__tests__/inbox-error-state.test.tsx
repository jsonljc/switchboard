import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InboxErrorState } from "../inbox-error-state";

describe("<InboxErrorState>", () => {
  it("renders the error eyebrow and heading (distinct from empty copy)", () => {
    render(<InboxErrorState onRetry={() => {}} />);
    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load your inbox.")).toBeInTheDocument();
  });

  it("renders the error body copy", () => {
    render(<InboxErrorState onRetry={() => {}} />);
    expect(
      screen.getByText(
        "Looks like the connection dropped. Try again — your team is still working in the background.",
      ),
    ).toBeInTheDocument();
  });

  it("never reuses the empty-state copy", () => {
    render(<InboxErrorState onRetry={() => {}} />);
    expect(screen.queryByText("That's everything.")).toBeNull();
    expect(screen.queryByText("Polling · checked just now")).toBeNull();
  });

  it("calls onRetry when the Try again button is clicked", () => {
    const onRetry = vi.fn();
    render(<InboxErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
