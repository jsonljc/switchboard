"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  // Track which action was last fired so `error` reflects only the most-recent
  // action's error (prevents a stale resume.error lingering after a successful halt).
  const [lastAction, setLastAction] = useState<"halt" | "resume" | null>(null);

  const governanceStatus = useGovernanceStatus();
  const emergencyHalt = useEmergencyHalt();
  const resume = useResume();

  const isPending = emergencyHalt.isPending || resume.isPending;

  // Seed from server: once the governance status query resolves, override local
  // state with the authoritative server value. Guard against infinite loops by
  // only updating when the derived server value actually differs from local.
  // Also skip while a mutation is in-flight — a stale refetch must not stomp
  // an optimistic update that hasn't settled yet.
  const serverHalted = governanceStatus.data?.deploymentStatus === "paused";
  useEffect(() => {
    if (governanceStatus.data === undefined) return;
    if (isPending) return; // don't stomp in-flight optimistic update
    if (serverHalted !== halted) {
      setHaltedState(serverHalted);
      writeLocal(serverHalted);
    }
  }, [governanceStatus.data, serverHalted, isPending]); // halted intentionally omitted: we only want to sync when the server data changes, not on every local optimistic update

  // Surface only the error from the MOST-RECENTLY-FIRED action. Without this,
  // a stale resume.error (e.g. readiness blocker) lingers even after a
  // subsequent successful halt clears emergencyHalt.error.
  const error: Error | null =
    lastAction === "halt"
      ? (emergencyHalt.error as Error | null)
      : lastAction === "resume"
        ? (resume.error as Error | null)
        : null;

  // Keep a ref to isPending so the callbacks inside useMemo always read the
  // current value without needing isPending in the dep array for the guard check.
  const isPendingRef = useRef(isPending);
  isPendingRef.current = isPending;

  const value = useMemo<HaltContextValue>(
    () => ({
      halted,
      isPending,
      error,
      setHalted: (next: boolean) => {
        // Guard: don't stack a second mutation while one is already in flight.
        // Two rapid calls capturing the same `halted` closure would otherwise
        // fire opposing mutations (e.g. halt then resume) back-to-back.
        if (isPendingRef.current) return;
        const prev = halted;
        // Optimistic update
        setHaltedState(next);
        writeLocal(next);
        if (next) {
          setLastAction("halt");
          emergencyHalt.mutate("Operator pause", {
            onError: () => {
              // Roll back on failure
              setHaltedState(prev);
              writeLocal(prev);
            },
          });
        } else {
          setLastAction("resume");
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
        // Guard: don't stack a second mutation while one is already in flight.
        if (isPendingRef.current) return;
        const next = !halted;
        const prev = halted;
        // Optimistic update
        setHaltedState(next);
        writeLocal(next);
        if (next) {
          setLastAction("halt");
          emergencyHalt.mutate("Operator pause", {
            onError: () => {
              setHaltedState(prev);
              writeLocal(prev);
            },
          });
        } else {
          setLastAction("resume");
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
