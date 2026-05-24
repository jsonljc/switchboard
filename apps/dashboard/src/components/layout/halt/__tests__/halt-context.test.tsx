import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, renderHook } from "@testing-library/react";

// Mutable state object so individual tests can override the returned data
// without re-importing (mutation is visible to the factory below).
const haltMutate = vi.fn();
const resumeMutate = vi.fn();
const statusState = {
  data: { deploymentStatus: "active" as string } as { deploymentStatus: string } | undefined,
};

// Per-test override for isPending flags so we can simulate in-flight mutations.
const pendingState = { halt: false, resume: false };
// Per-test override for error values.
const errorState = { halt: null as Error | null, resume: null as Error | null };

vi.mock("@/hooks/use-governance", () => ({
  useEmergencyHalt: () => ({
    mutate: haltMutate,
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: pendingState.halt,
    error: errorState.halt,
  }),
  useResume: () => ({
    mutate: resumeMutate,
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: pendingState.resume,
    error: errorState.resume,
  }),
  useGovernanceStatus: () => ({ data: statusState.data, isLoading: false }),
}));

// Import AFTER vi.mock so the hoisted mock is in place
import { HaltProvider, useHalt } from "../halt-context";

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function Fixture({ label }: { label: string }) {
  const { halted, toggleHalt, setHalted, isPending, error } = useHalt();
  return (
    <div>
      <span data-testid="status">{halted ? "HALTED" : "LIVE"}</span>
      <span data-testid="pending">{isPending ? "pending" : "idle"}</span>
      <span data-testid="error">{error?.message ?? "none"}</span>
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
    // Default: server says LIVE, no pending, no error
    statusState.data = { deploymentStatus: "active" };
    pendingState.halt = false;
    pendingState.resume = false;
    errorState.halt = null;
    errorState.resume = null;
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

  // ------- Fix 2: rapid-toggle race guard (replaces dropped regression test) -------

  it("rapid toggle race: second toggleHalt while mutation is pending fires NO second mutation", () => {
    statusState.data = { deploymentStatus: "active" };
    // First toggle: haltMutate is called; mark halt as pending so the mock
    // reflects in-flight state for the second click.
    haltMutate.mockImplementation(() => {
      // Simulate mutation staying in-flight (no resolution)
      pendingState.halt = true;
    });
    renderWithProvider();

    // First click: LIVE → HALTED, fires emergencyHalt.mutate once
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(haltMutate).toHaveBeenCalledTimes(1);

    // Second click while halt mutation is still pending: must be a no-op.
    // The isPendingRef guard should block it before touching resumeMutate.
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(haltMutate).toHaveBeenCalledTimes(1); // still exactly 1
    expect(resumeMutate).not.toHaveBeenCalled(); // no opposing mutation fired
  });

  it("rapid setHalted race: second setHalted call while pending fires NO second mutation", () => {
    statusState.data = { deploymentStatus: "active" };
    haltMutate.mockImplementation(() => {
      pendingState.halt = true;
    });
    renderWithProvider();

    // First call: LIVE → HALTED
    act(() => {
      screen.getByTestId("set-halt").click();
    });
    expect(haltMutate).toHaveBeenCalledTimes(1);

    // Second call while still pending: blocked
    act(() => {
      screen.getByTestId("set-halt").click();
    });
    expect(haltMutate).toHaveBeenCalledTimes(1);
    expect(resumeMutate).not.toHaveBeenCalled();
  });

  // ------- Fix 4: stale error — last action wins -------

  it("error reflects only the last-fired action: stale resume.error not surfaced after successful halt", () => {
    // Arrange: resume had a prior error, halt has no error.
    // lastAction starts null — no error should show yet.
    statusState.data = { deploymentStatus: "active" };
    errorState.resume = new Error("Cannot resume — blockers present");
    errorState.halt = null;
    renderWithProvider();

    // No action fired yet → error = null (lastAction is null)
    expect(screen.getByTestId("error").textContent).toBe("none");

    // Fire a halt action (emergencyHalt.mutate is called, no error on halt)
    haltMutate.mockImplementation(() => undefined);
    act(() => {
      screen.getByTestId("set-halt").click();
    });

    // Last action = "halt", emergencyHalt.error = null → context error must be null
    // even though resume.error is still set to the stale blocker error.
    expect(screen.getByTestId("error").textContent).toBe("none");
  });
});
