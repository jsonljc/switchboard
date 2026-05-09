import { act, render, renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { HaltProvider, useHalt } from "../halt-context";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HaltProvider>{children}</HaltProvider>
);

describe("HaltProvider + useHalt", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("starts halted=false when no localStorage value", () => {
    const { result } = renderHook(() => useHalt(), { wrapper });
    expect(result.current.halted).toBe(false);
  });

  it("reads sb_halt_state='1' as halted=true on mount", () => {
    window.localStorage.setItem("sb_halt_state", "1");
    const { result } = renderHook(() => useHalt(), { wrapper });
    expect(result.current.halted).toBe(true);
  });

  it("toggleHalt flips state and writes to localStorage", () => {
    const { result } = renderHook(() => useHalt(), { wrapper });
    act(() => result.current.toggleHalt());
    expect(result.current.halted).toBe(true);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    act(() => result.current.toggleHalt());
    expect(result.current.halted).toBe(false);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("setHalted(true) sets halted to true", () => {
    const { result } = renderHook(() => useHalt(), { wrapper });
    act(() => result.current.setHalted(true));
    expect(result.current.halted).toBe(true);
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
  });

  it("two consumers share state across rapid toggles (Phase 1 race regression)", () => {
    function ConsumerA() {
      const { halted, toggleHalt } = useHalt();
      return (
        <button data-testid="a" onClick={toggleHalt}>
          {halted ? "A:halted" : "A:live"}
        </button>
      );
    }
    function ConsumerB() {
      const { halted, toggleHalt } = useHalt();
      return (
        <button data-testid="b" onClick={toggleHalt}>
          {halted ? "B:halted" : "B:live"}
        </button>
      );
    }
    const { getByTestId } = render(
      <HaltProvider>
        <ConsumerA />
        <ConsumerB />
      </HaltProvider>,
    );
    act(() => getByTestId("a").click());
    expect(getByTestId("a").textContent).toBe("A:halted");
    expect(getByTestId("b").textContent).toBe("B:halted");
    act(() => getByTestId("b").click());
    expect(getByTestId("a").textContent).toBe("A:live");
    expect(getByTestId("b").textContent).toBe("B:live");
    act(() => getByTestId("a").click());
    expect(getByTestId("a").textContent).toBe("A:halted");
    expect(getByTestId("b").textContent).toBe("B:halted");
  });

  it("useHalt outside provider throws", () => {
    expect(() => renderHook(() => useHalt())).toThrow(/useHalt must be used inside <HaltProvider>/);
  });
});
