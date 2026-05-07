import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectCapiStep } from "./improve-spend-setup";

describe("ConnectCapiStep", () => {
  function renderStep(overrides: Partial<React.ComponentProps<typeof ConnectCapiStep>> = {}) {
    const props: React.ComponentProps<typeof ConnectCapiStep> = {
      pixelId: "",
      loading: false,
      error: null,
      onPixelIdChange: vi.fn(),
      onSave: vi.fn(),
      ...overrides,
    };
    render(<ConnectCapiStep {...props} />);
    return props;
  }

  it("renders the step title and explainer copy", () => {
    renderStep();
    expect(
      screen.getByRole("heading", { name: /connect.*conversions api|connect.*pixel/i }),
    ).toBeInTheDocument();
    // Label + helper copy both mention pixel id, so use the labelled input.
    expect(screen.getByLabelText(/pixel id/i)).toBeInTheDocument();
    expect(screen.getAllByText(/signal[- ]?health|conversion/i).length).toBeGreaterThan(0);
  });

  it("disables the save button when pixel id is empty", () => {
    renderStep({ pixelId: "" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    expect(button).toBeDisabled();
  });

  it("disables the save button while loading", () => {
    renderStep({ pixelId: "1234567890", loading: true });
    const button = screen.getByRole("button", { name: /save|continue|enable|saving/i });
    expect(button).toBeDisabled();
  });

  it("disables the save button when pixel id is non-numeric", () => {
    // Meta pixel ids are numeric strings; reject obvious bad input early.
    renderStep({ pixelId: "abc" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    expect(button).toBeDisabled();
  });

  it("enables the save button when a valid-looking pixel id is entered", () => {
    renderStep({ pixelId: "1234567890123456" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    expect(button).not.toBeDisabled();
  });

  it("calls onPixelIdChange when the input value changes", () => {
    const props = renderStep({ pixelId: "" });
    const input = screen.getByLabelText(/pixel id/i);
    fireEvent.change(input, { target: { value: "9999999999" } });
    expect(props.onPixelIdChange).toHaveBeenCalledWith("9999999999");
  });

  it("calls onSave when the save button is clicked", () => {
    const props = renderStep({ pixelId: "1234567890123456" });
    const button = screen.getByRole("button", { name: /save|continue|enable/i });
    fireEvent.click(button);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when one is provided", () => {
    renderStep({ pixelId: "1234567890", error: "Could not save pixel id" });
    expect(screen.getByText(/could not save pixel id/i)).toBeInTheDocument();
  });

  it("does not allow skipping — there is no skip button", () => {
    renderStep({ pixelId: "" });
    // The whole point: pixel id is mandatory for this agent. No bypass.
    expect(screen.queryByRole("button", { name: /skip|later|maybe/i })).toBeNull();
  });
});
