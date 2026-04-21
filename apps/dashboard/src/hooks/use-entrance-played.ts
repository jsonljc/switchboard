"use client";

import { useCallback, useState } from "react";

const KEY = "sw-entrance-played";

function readStorage(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useEntrancePlayed() {
  const [hasPlayed, setHasPlayed] = useState(readStorage);

  const markPlayed = useCallback(() => {
    setHasPlayed(true);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      // sessionStorage unavailable — animation plays every time, harmless
    }
  }, []);

  return { hasPlayed, markPlayed };
}
