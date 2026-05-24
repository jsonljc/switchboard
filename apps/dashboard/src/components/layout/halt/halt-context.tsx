"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useGovernanceStatus, useEmergencyHalt, useResume } from "@/hooks/use-governance";

const STORAGE_KEY = "sb_halt_state";

// localStorage is kept as a PRE-HYDRATION HINT only: it seeds the initial
// useState value so the UI shows the right state immediately on reload before
// the server query responds. Once `useGovernanceStatus` returns `data`, the
// server value WINS and overwrites the local hint. This avoids a brief flash
// where the UI shows "LIVE" on reload for a truly-paused deployment.
function readLocal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeLocal(halted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, halted ? "1" : "0");
  } catch {
    // localStorage may be unavailable (private mode, quota); fail silent
  }
}

type HaltContextValue = {
  halted: boolean;
  isPending: boolean;
  error: Error | null;
  setHalted: (next: boolean) => void;
  toggleHalt: () => void;
};

const HaltContext = createContext<HaltContextValue | null>(null);

// State-only provider. Do NOT call useToast() or any side-effect hooks here —
// toast firing lives at the call sites (OpStrip click, keyboard handler).
// `error` and `isPending` are exposed so call sites can react to mutation state
// (e.g. show readiness blocker text from C1's resume error).
export function HaltProvider({ children }: { children: ReactNode }) {
  const [halted, setHaltedState] = useState<boolean>(() => readLocal());

  const governanceStatus = useGovernanceStatus();
  const emergencyHalt = useEmergencyHalt();
  const resume = useResume();

  // Seed from server: once the governance status query resolves, override local
  // state with the authoritative server value. Guard against infinite loops by
  // only updating when the derived server value actually differs from local.
  const serverHalted = governanceStatus.data?.deploymentStatus === "paused";
  useEffect(() => {
    if (governanceStatus.data === undefined) return;
    if (serverHalted !== halted) {
      setHaltedState(serverHalted);
      writeLocal(serverHalted);
    }
  }, [governanceStatus.data, serverHalted]); // halted intentionally omitted: we only want to sync when the server data changes, not on every local optimistic update

  const isPending = emergencyHalt.isPending || resume.isPending;
  const error: Error | null =
    (emergencyHalt.error as Error | null) ?? (resume.error as Error | null);

  const value = useMemo<HaltContextValue>(
    () => ({
      halted,
      isPending,
      error,
      setHalted: (next: boolean) => {
        const prev = halted;
        // Optimistic update
        setHaltedState(next);
        writeLocal(next);
        if (next) {
          emergencyHalt.mutate("Operator pause", {
            onError: () => {
              // Roll back on failure
              setHaltedState(prev);
              writeLocal(prev);
            },
          });
        } else {
          resume.mutate(undefined, {
            onError: () => {
              // Roll back on failure
              setHaltedState(prev);
              writeLocal(prev);
            },
          });
        }
      },
      toggleHalt: () => {
        const next = !halted;
        const prev = halted;
        // Optimistic update
        setHaltedState(next);
        writeLocal(next);
        if (next) {
          emergencyHalt.mutate("Operator pause", {
            onError: () => {
              setHaltedState(prev);
              writeLocal(prev);
            },
          });
        } else {
          resume.mutate(undefined, {
            onError: () => {
              setHaltedState(prev);
              writeLocal(prev);
            },
          });
        }
      },
    }),
    [halted, isPending, error],
  );

  return <HaltContext.Provider value={value}>{children}</HaltContext.Provider>;
}

export function useHalt(): HaltContextValue {
  const ctx = useContext(HaltContext);
  if (!ctx) throw new Error("useHalt must be used inside <HaltProvider>");
  return ctx;
}
