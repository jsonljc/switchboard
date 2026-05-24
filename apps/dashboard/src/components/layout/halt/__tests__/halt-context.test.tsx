import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, renderHook } from "@testing-library/react";

// Mutable state object so individual tests can override the returned data
// without re-importing (mutation is visible to the factory below).
const haltMutate = vi.fn();
const resumeMutate = vi.fn();
const statusState = {
  data: { deploymentStatus: "active" as string } as { deploymentStatus: string } | undefined,
};

vi.mock("@/hooks/use-governance", () => ({
  useEmergencyHalt: () => ({
    mutate: haltMutate,
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    error: null,
  }),
  useResume: () => ({
    mutate: resumeMutate,
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    error: null,
  }),
  useGovernanceStatus: () => ({ data: statusState.data, isLoading: false }),
}));

// Import AFTER vi.mock so the hoisted mock is in place
import { HaltProvider, useHalt } from "../halt-context";

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function Fixture({ label }: { label: string }) {
  const { halted, toggleHalt, setHalted } = useHalt();
  return (
    <div>
      <span data-testid="status">{halted ? "HALTED" : "LIVE"}</span>
      <button data-testid="toggle" onClick={toggleHalt}>
        toggle
      </button>
      <button data-testid="set-halt" onClick={() => setHalted(true)}>
        halt
      </button>
      <button data-testid="set-live" onClick={() => setHalted(false)}>
        live
      </button>
      <span data-testid="label">{label}</span>
    </div>
  );
}

function renderWithProvider(label = "test") {
  return render(
    <HaltProvider>
      <Fixture label={label} />
    </HaltProvider>,
  );
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("HaltProvider + useHalt (server-backed)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    haltMutate.mockReset();
    resumeMutate.mockReset();
    // Default: server says LIVE
    statusState.data = { deploymentStatus: "active" };
  });

  // ------- Server seeding -------

  it('seeds halted=false when server returns deploymentStatus:"active"', () => {
    statusState.data = { deploymentStatus: "active" };
    renderWithProvider();
    expect(screen.getByTestId("status").textContent).toBe("LIVE");
  });

  it('seeds halted=true when server returns deploymentStatus:"paused"', () => {
    statusState.data = { deploymentStatus: "paused" };
    renderWithProvider();
    // The useEffect that syncs server→local state runs inside RTL's act wrapper
    // around render, so the DOM should already reflect the server value.
    expect(screen.getByTestId("status").textContent).toBe("HALTED");
  });

  // ------- Mutations fired on toggle -------

  it("toggleHalt from LIVE fires emergencyHalt.mutate", () => {
    statusState.data = { deploymentStatus: "active" };
    haltMutate.mockImplementation(() => undefined);
    renderWithProvider();
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(haltMutate).toHaveBeenCalledWith(
      "Operator pause",
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(resumeMutate).not.toHaveBeenCalled();
  });

  it("toggleHalt from HALTED fires resume.mutate", () => {
    statusState.data = { deploymentStatus: "paused" };
    resumeMutate.mockImplementation(() => undefined);
    renderWithProvider();
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(resumeMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(haltMutate).not.toHaveBeenCalled();
  });

  it("setHalted(true) from LIVE fires emergencyHalt.mutate", () => {
    statusState.data = { deploymentStatus: "active" };
    haltMutate.mockImplementation(() => undefined);
    renderWithProvider();
    act(() => {
      screen.getByTestId("set-halt").click();
    });
    expect(haltMutate).toHaveBeenCalledWith(
      "Operator pause",
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("setHalted(false) from HALTED fires resume.mutate", () => {
    statusState.data = { deploymentStatus: "paused" };
    resumeMutate.mockImplementation(() => undefined);
    renderWithProvider();
    act(() => {
      screen.getByTestId("set-live").click();
    });
    expect(resumeMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  // ------- Optimistic update + rollback on error -------

  it("optimistic toggle: shows HALTED immediately before mutation resolves", () => {
    statusState.data = { deploymentStatus: "active" };
    // mutate never calls onError → stays in pending optimistic state
    haltMutate.mockImplementation(() => undefined);
    renderWithProvider();
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(screen.getByTestId("status").textContent).toBe("HALTED");
  });

  it("rolls back halted→live when emergencyHalt.mutate calls onError", () => {
    statusState.data = { deploymentStatus: "active" };
    // Simulate immediate onError call (server rejected the halt)
    haltMutate.mockImplementation((_arg: unknown, opts?: { onError?: (err: Error) => void }) => {
      opts?.onError?.(new Error("server rejected halt"));
    });
    renderWithProvider();
    act(() => {
      screen.getByTestId("toggle").click();
    });
    // Should roll back to LIVE
    expect(screen.getByTestId("status").textContent).toBe("LIVE");
  });

  it("rolls back live→halted when resume.mutate calls onError", () => {
    statusState.data = { deploymentStatus: "paused" };
    // Simulate immediate onError call (readiness blockers)
    resumeMutate.mockImplementation((_arg: unknown, opts?: { onError?: (err: Error) => void }) => {
      opts?.onError?.(new Error("Cannot resume — blockers: Connection missing"));
    });
    renderWithProvider();
    act(() => {
      screen.getByTestId("toggle").click();
    });
    // Should roll back to HALTED
    expect(screen.getByTestId("status").textContent).toBe("HALTED");
  });

  // ------- Guard: hook outside provider -------

  it("useHalt() outside HaltProvider throws", () => {
    expect(() => renderHook(() => useHalt())).toThrow(/useHalt must be used inside <HaltProvider>/);
  });
});
