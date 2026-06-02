import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UndoCountdown, undoToastProps } from "../undo-toast";

afterEach(() => vi.useRealTimers());

describe("UndoCountdown", () => {
  it("renders the remaining undo window and ticks down", () => {
    vi.useFakeTimers();
    const undoableUntil = new Date(Date.now() + 65_000).toISOString();
    render(<UndoCountdown undoableUntil={undoableUntil} />);
    expect(screen.getByText(/undoable for 1:05/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/undoable for 1:00/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no undo window", () => {
    const { container } = render(<UndoCountdown undoableUntil={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("undoToastProps", () => {
  it("binds the toast duration to the undo window and wires Undo", () => {
    const onUndo = vi.fn();
    const undoableUntil = new Date(Date.now() + 30_000).toISOString();
    const props = undoToastProps({ contactName: "Maya R.", undoableUntil, onUndo });

    // Duration tracks the real window — the toast lives exactly as long as undo is possible.
    expect(props.duration).toBeGreaterThan(20_000);
    expect(props.duration).toBeLessThanOrEqual(30_000);
    expect(props.className).toBe("toast-undo");

    render(<>{props.action}</>);
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("falls back to a finite duration when there is no undo window", () => {
    const props = undoToastProps({ onUndo: vi.fn() });
    expect(props.duration).toBeGreaterThan(0);
    expect(Number.isFinite(props.duration)).toBe(true);
  });
});
