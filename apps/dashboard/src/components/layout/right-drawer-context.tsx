"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type RightDrawerKind = "inbox" | "opportunity";

type RightDrawerValue = {
  kind: RightDrawerKind | null;
  open: (kind: RightDrawerKind) => void;
  close: () => void;
};

const Ctx = createContext<RightDrawerValue | null>(null);

export function RightDrawerProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<RightDrawerKind | null>(null);
  const open = useCallback((next: RightDrawerKind) => setKind(next), []);
  const close = useCallback(() => setKind(null), []);
  const value = useMemo(() => ({ kind, open, close }), [kind, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRightDrawer(): RightDrawerValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useRightDrawer must be used inside a RightDrawerProvider");
  }
  return v;
}
