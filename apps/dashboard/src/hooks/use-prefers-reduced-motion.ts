"use client";

import { useEffect, useState } from "react";

/** OS reduced-motion preference. Shared by the printed-portrait avatar and the
 *  Mira feed autoplay gate. Two-pass: starts false (SSR-safe, matches server
 *  render) then updates post-mount so markup derived from this value (e.g.
 *  data-playing) is identical on server and first client paint. jsdom mocks may
 *  omit the listener API, hence the optional chaining. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
