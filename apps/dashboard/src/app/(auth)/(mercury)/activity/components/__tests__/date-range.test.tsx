import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRange } from "../date-range.js";

describe("DateRange", () => {
  it("renders two date inputs with after/before eyebrow labels", () => {
    render(<DateRange after={null} before={null} onChange={() => {}} />);
    expect(screen.getByText(/^after$/)).toBeInTheDocument();
    expect(screen.getByText(/^before$/)).toBeInTheDocument();
    const afterInput = screen.getByLabelText(/^after$/) as HTMLInputElement;
    const beforeInput = screen.getByLabelText(/^before$/) as HTMLInputElement;
    expect(afterInput.type).toBe("date");
    expect(beforeInput.type).toBe("date");
  });

  it("typing into `after` fires onChange and preserves `before`", () => {
    const onChange = vi.fn();
    render(<DateRange after={null} before="2026-05-09" onChange={onChange} />);
    const afterInput = screen.getByLabelText(/^after$/) as HTMLInputElement;
    fireEvent.change(afterInput, { target: { value: "2026-05-01" } });
    expect(onChange).toHaveBeenCalledWith({ after: "2026-05-01", before: "2026-05-09" });
  });

  it("× clear button does NOT render when neither date is set", () => {
    render(<DateRange after={null} before={null} onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /clear dates/i })).toBeNull();
  });

  it("× clear button renders when at least one date is set; clicking clears both", async () => {
    const onChange = vi.fn();
    render(<DateRange after="2026-05-01" before="2026-05-09" onChange={onChange} />);
    const clearBtn = screen.getByRole("button", { name: /clear dates/i });
    expect(clearBtn).toBeInTheDocument();
    await userEvent.setup().click(clearBtn);
    expect(onChange).toHaveBeenCalledWith({ after: null, before: null });
  });
});
