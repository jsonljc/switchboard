import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useViewPreference } from "../use-view-preference.js";

describe("useViewPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to staff when no preference set", () => {
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.view).toBe("staff");
  });

  it("reads owner preference from localStorage", () => {
    localStorage.setItem("switchboard.view-preference", "owner");
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.view).toBe("owner");
  });

  it("toggles between owner and staff", () => {
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.view).toBe("staff");

    act(() => {
      result.current.setView("owner");
    });
    expect(result.current.view).toBe("owner");
    expect(localStorage.getItem("switchboard.view-preference")).toBe("owner");
  });

  it("returns isOwner and isStaff booleans", () => {
    localStorage.setItem("switchboard.view-preference", "owner");
    const { result } = renderHook(() => useViewPreference());
    expect(result.current.isOwner).toBe(true);
    expect(result.current.isStaff).toBe(false);
  });
});
