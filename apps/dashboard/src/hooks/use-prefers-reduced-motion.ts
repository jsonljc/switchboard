"use client";

import { useEffect, useState } from "react";

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** OS reduced-motion preference. Shared by the printed-portrait avatar and the
 *  Mira feed autoplay gate. Initialised eagerly on the client so the first
 *  render already holds the correct value (avoids a play→pause flash). jsdom
 *  mocks may omit the listener API, hence the optional chaining. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
