"use client";

import { useState, useEffect } from "react";

/**
 * Returns true when viewport width ≥ 1024px (lg breakpoint).
 *
 * - SSR returns false; on the client it resolves synchronously on first render
 *   (no post-effect flip, so consumers may drive animation direction safely).
 * - Updates reactively via a MediaQueryList `change` listener.
 * - jsdom has no matchMedia → always returns false in tests (avoids ReferenceError).
 *
 * Caution: a consumer that renders during hydration and branches its DOM on this value
 * can hit a hydration mismatch (SSR=false, client=true) — mount-gate or use
 * `suppressHydrationWarning` if so. The only consumer today (AgentPanel) mounts
 * client-side on user action, so it is unaffected. (results-page.tsx keeps the older
 * mount-then-flip matchMedia pattern — the hydration-safe choice in the SSR path.)
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );

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
