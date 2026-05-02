import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ReactNode } from "react";
import { ToastProvider, useToast } from "../use-toast";

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

describe("useToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts with toast=null", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(result.current.toast).toBeNull();
  });

  it("showToast sets the toast state", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => {
      result.current.showToast({
        title: "Halted",
        detail: "all agents halted",
        undoable: false,
      });
    });
    expect(result.current.toast).toEqual({
      title: "Halted",
      detail: "all agents halted",
      undoable: false,
    });
  });

  it("auto-dismisses after 4500ms", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast({ title: "X", detail: "Y", undoable: false }));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(4499));
    expect(result.current.toast).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it("dismissToast clears immediately and cancels the timer", () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast({ title: "X", detail: "Y", undoable: false }));
    act(() => result.current.dismissToast());
    expect(result.current.toast).toBeNull();
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current.toast).toBeNull();
  });

  it("preserves onUndo callback through state", () => {
    const onUndo = vi.fn();
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() =>
      result.current.showToast({
        title: "Halted",
        detail: "all agents halted",
        undoable: true,
        onUndo,
      }),
    );
    expect(result.current.toast?.onUndo).toBe(onUndo);
  });

  it("throws when used outside <ToastProvider>", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(
      /useToast must be used within a ToastProvider/,
    );
    consoleError.mockRestore();
  });
});
