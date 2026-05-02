"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sb_halt_state";

function readHalted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHalted(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

export type HaltState = {
  halted: boolean;
  toggleHalt: () => void;
  setHalted: (next: boolean) => void;
};

export function useHaltState(): HaltState {
  const [halted, setHaltedState] = useState<boolean>(false);

  useEffect(() => {
    setHaltedState(readHalted());
  }, []);

  const setHalted = useCallback((next: boolean) => {
    writeHalted(next);
    setHaltedState(next);
  }, []);

  const toggleHalt = useCallback(() => {
    setHaltedState((prev) => {
      const next = !prev;
      writeHalted(next);
      return next;
    });
  }, []);

  return { halted, toggleHalt, setHalted };
}
