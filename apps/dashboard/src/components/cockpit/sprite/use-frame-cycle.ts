import { useEffect, useState } from "react";
import type { AnimFrame, Frame } from "./types";

export interface UseFrameCycleOptions {
  playing?: boolean;
}

/** Frame-swap hook. Semantics (spec §5.3):
 *  - frames.length === 0 → returns null. No timer.
 *  - frames.length === 1 → returns frames[0].rows statically. No timer.
 *  - frames.length >= 2 → cycles via setTimeout per frame.dur. Timer cleared on unmount.
 *  - playing === false → returns frames[0].rows statically regardless of count. No timer. */
export function useFrameCycle(
  frames: readonly AnimFrame[],
  { playing = true }: UseFrameCycleOptions = {},
): Frame | null {
  const [idx, setIdx] = useState(0);
  const length = frames.length;
  const shouldCycle = playing && length >= 2;
  useEffect(() => {
    if (!shouldCycle) return;
    const f = frames[idx % length];
    const t = setTimeout(() => setIdx((i) => (i + 1) % length), f?.dur ?? 400);
    return () => clearTimeout(t);
  }, [idx, frames, shouldCycle, length]);
  if (length === 0) return null;
  return frames[idx % length]?.rows ?? frames[0]!.rows;
}
