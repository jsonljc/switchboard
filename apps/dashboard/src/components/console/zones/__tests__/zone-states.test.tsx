import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ZoneSkeleton, ZoneError, ZoneEmpty } from "../zone-states";

describe("zone state components", () => {
  it("ZoneSkeleton renders an aria-busy region", () => {
    render(<ZoneSkeleton label="Loading numbers" />);
    expect(screen.getByLabelText("Loading numbers")).toHaveAttribute("aria-busy", "true");
  });

  it("ZoneError renders message + retry button", () => {
    const onRetry = vi.fn();
    render(<ZoneError message="Couldn't load queue" onRetry={onRetry} />);
    expect(screen.getByText(/couldn't load queue/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ZoneEmpty renders message and optional cta", () => {
    render(<ZoneEmpty message="No items yet" />);
    expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
  });
});
