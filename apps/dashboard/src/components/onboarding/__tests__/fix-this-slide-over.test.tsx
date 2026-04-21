import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FixThisSlideOver } from "../fix-this-slide-over";

describe("FixThisSlideOver", () => {
  it("renders fix options when open", () => {
    render(<FixThisSlideOver isOpen={true} onClose={vi.fn()} onFix={vi.fn()} />);
    expect(screen.getByText("Wrong information")).toBeTruthy();
    expect(screen.getByText("Tone is off")).toBeTruthy();
    expect(screen.getByText("Missing context")).toBeTruthy();
  });

  it("shows section-specific guidance for wrong_info when relevantSection is provided", () => {
    render(
      <FixThisSlideOver
        isOpen={true}
        onClose={vi.fn()}
        onFix={vi.fn()}
        relevantSection="services"
      />,
    );
    fireEvent.click(screen.getByText("Wrong information"));
    expect(screen.getByText(/Services/)).toBeTruthy();
    expect(screen.getByText(/playbook/i)).toBeTruthy();
  });

  it("returns null when not open", () => {
    const { container } = render(
      <FixThisSlideOver isOpen={false} onClose={vi.fn()} onFix={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("falls back to generic prompt when no relevantSection", () => {
    render(<FixThisSlideOver isOpen={true} onClose={vi.fn()} onFix={vi.fn()} />);
    fireEvent.click(screen.getByText("Wrong information"));
    expect(screen.getByText(/incorrect/i)).toBeTruthy();
  });
});
