"use client";

import { useState, useEffect } from "react";

/**
 * Returns true when viewport width ≥ 1024px (lg breakpoint).
 *
 * - Returns false on first render / SSR (safe default for mobile-first markup).
 * - Updates reactively via a MediaQueryList `change` listener.
 * - jsdom has no matchMedia → always returns false in tests (avoids ReferenceError).
 *
 * Mirror of the inline matchMedia pattern in results-page.tsx.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mq.matches);
    function handleChange(e: MediaQueryListEvent) {
      setIsDesktop(e.matches);
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  return isDesktop;
}
