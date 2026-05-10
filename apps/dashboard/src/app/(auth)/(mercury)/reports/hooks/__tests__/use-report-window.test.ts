import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useReportWindow, __TEST_ONLY__ } from "../use-report-window";

const KEY = __TEST_ONLY__.STORAGE_KEY;

describe("useReportWindow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to THIS MONTH on first load", () => {
    const { result } = renderHook(() => useReportWindow());
    expect(result.current.window).toBe("THIS MONTH");
  });

  it("rehydrates from localStorage after mount", async () => {
    window.localStorage.setItem(KEY, "THIS QUARTER");
    const { result } = renderHook(() => useReportWindow());
    await waitFor(() => {
      expect(result.current.window).toBe("THIS QUARTER");
    });
  });

  it("ignores invalid persisted values", async () => {
    window.localStorage.setItem(KEY, "YESTERDAY");
    const { result } = renderHook(() => useReportWindow());
    // The default still wins.
    await waitFor(() => {
      expect(result.current.window).toBe("THIS MONTH");
    });
  });

  it("persists changes to localStorage", () => {
    const { result } = renderHook(() => useReportWindow());
    act(() => result.current.setWindow("THIS WEEK"));
    expect(result.current.window).toBe("THIS WEEK");
    expect(window.localStorage.getItem(KEY)).toBe("THIS WEEK");
  });
});
