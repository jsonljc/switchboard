"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "sb_halt_state";

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
  setHalted: (next: boolean) => void;
  toggleHalt: () => void;
};

const HaltContext = createContext<HaltContextValue | null>(null);

// State-only provider. Do NOT call useToast() or any side-effect hook here —
// toast firing lives at the call sites (OpStrip click, keyboard handler).
export function HaltProvider({ children }: { children: ReactNode }) {
  const [halted, setHaltedState] = useState<boolean>(() => readLocal());

  useEffect(() => {
    writeLocal(halted);
  }, [halted]);

  const value = useMemo<HaltContextValue>(
    () => ({
      halted,
      setHalted: (next: boolean) => setHaltedState(next),
      toggleHalt: () => setHaltedState((v) => !v),
    }),
    [halted],
  );

  return <HaltContext.Provider value={value}>{children}</HaltContext.Provider>;
}

export function useHalt(): HaltContextValue {
  const ctx = useContext(HaltContext);
  if (!ctx) throw new Error("useHalt must be used inside <HaltProvider>");
  return ctx;
}

type ShowToast = (t: {
  title: string;
  detail: string;
  undoable: boolean;
  onUndo?: () => void;
}) => void;

// Shared toggle-with-toast helper. Both the OpStrip click handler and the
// keyboard `H` handler call this so their copy + undo behavior stays in lockstep.
// Pure function — pass in the values from useHalt() + useToast() at the call site.
export function toggleHaltWithToast(deps: {
  halted: boolean;
  toggleHalt: () => void;
  setHalted: (next: boolean) => void;
  showToast: ShowToast;
}): void {
  const { halted, toggleHalt, setHalted, showToast } = deps;
  const wasHalted = halted;
  toggleHalt();
  showToast({
    title: wasHalted ? "Resumed" : "Halted",
    detail: wasHalted ? "All agents resumed." : "all agents halted — actions queued",
    undoable: true,
    onUndo: () => setHalted(wasHalted),
  });
}
