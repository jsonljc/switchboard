// apps/dashboard/src/lib/data-mode/client.tsx
"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DATA_MODE_COOKIE, type DataMode } from "./shared";

const DataModeContext = createContext<DataMode>("live");

/**
 * Provider seeded from the server-resolved cookie value. Mount inside the
 * authenticated layout so every consumer sees the same mode SSR rendered with.
 */
export function DataModeProvider({ mode, children }: { mode: DataMode; children: ReactNode }) {
  return <DataModeContext.Provider value={mode}>{children}</DataModeContext.Provider>;
}

/**
 * Read the current data mode. Returns the server-resolved value via context —
 * no useState initializer, no hydration drift.
 */
export function useDataMode(): DataMode {
  return useContext(DataModeContext);
}

/**
 * Set the cookie and refresh the route tree so RSC re-renders with the new
 * mode. In production, the server resolver still normalizes to "live", so
 * this write is ignored downstream.
 */
export function useSetDataMode(): (next: DataMode) => void {
  const router = useRouter();
  return useCallback(
    (next) => {
      const secure =
        typeof window !== "undefined" && window.location.protocol === "https:" ? "; secure" : "";
      document.cookie =
        `${DATA_MODE_COOKIE}=${encodeURIComponent(next)}; path=/; ` +
        `max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`;
      router.refresh();
    },
    [router],
  );
}

/**
 * Convenience hook combining read + write for components that need both
 * (e.g., the DevPanel toggle).
 */
export function useDataModeControls(): { mode: DataMode; setMode: (next: DataMode) => void } {
  const mode = useDataMode();
  const setMode = useSetDataMode();
  return { mode, setMode };
}
