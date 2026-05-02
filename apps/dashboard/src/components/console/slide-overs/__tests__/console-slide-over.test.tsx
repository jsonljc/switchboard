import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsoleSlideOver } from "../console-slide-over";

describe("ConsoleSlideOver", () => {
  it("renders children when open", () => {
    render(
      <ConsoleSlideOver open onOpenChange={() => {}} title="Test">
        <p>Body</p>
      </ConsoleSlideOver>,
    );
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("does not render children when closed", () => {
    render(
      <ConsoleSlideOver open={false} onOpenChange={() => {}} title="Test">
        <p>Body</p>
      </ConsoleSlideOver>,
    );
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("calls onOpenChange(false) when close button clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <ConsoleSlideOver open onOpenChange={onOpenChange} title="Test">
        <p>Body</p>
      </ConsoleSlideOver>,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
