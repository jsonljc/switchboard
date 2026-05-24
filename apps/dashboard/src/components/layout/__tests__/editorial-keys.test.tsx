// apps/dashboard/src/components/layout/__tests__/editorial-keys.test.tsx
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { HaltProvider } from "../halt/halt-context";
import { EditorialKeys } from "../editorial-keys";

// Tool A: stub use-governance so HaltProvider mounts without QueryClient/SessionProvider.
// data: undefined prevents the server-sync useEffect from overriding local state.
vi.mock("@/hooks/use-governance", () => ({
  useGovernanceStatus: () => ({ data: undefined, isLoading: false }),
  useEmergencyHalt: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useResume: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null }),
}));

function pressKey(key: string, opts: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));
  });
}

describe("EditorialKeys", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("opens the HelpOverlay when ? is pressed and closes on second ?", () => {
    render(
      <HaltProvider>
        <EditorialKeys />
      </HaltProvider>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pressKey("?");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the HelpOverlay when Esc is pressed", () => {
    render(
      <HaltProvider>
        <EditorialKeys />
      </HaltProvider>,
    );
    pressKey("?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressKey("Escape");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles halted state when H is pressed", () => {
    render(
      <HaltProvider>
        <EditorialKeys />
      </HaltProvider>,
    );
    expect(window.localStorage.getItem("sb_halt_state")).not.toBe("1");
    pressKey("h");
    expect(window.localStorage.getItem("sb_halt_state")).toBe("1");
    pressKey("h");
    expect(window.localStorage.getItem("sb_halt_state")).toBe("0");
  });

  it("ignores keypresses dispatched on input/textarea targets", () => {
    render(
      <>
        <input data-testid="ed" />
        <HaltProvider>
          <EditorialKeys />
        </HaltProvider>
      </>,
    );
    const input = screen.getByTestId("ed");
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    });
    expect(window.localStorage.getItem("sb_halt_state")).not.toBe("1");
  });
});
