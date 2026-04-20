"use client";

import { useState, useCallback, useEffect } from "react";

export type ViewPreference = "owner" | "staff";

const STORAGE_KEY = "switchboard.view-preference";

function readPreference(): ViewPreference {
  if (typeof window === "undefined") return "owner";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "owner" || stored === "staff") return stored;
  return "owner";
}

export function useViewPreference() {
  const [view, setViewState] = useState<ViewPreference>("staff");

  useEffect(() => {
    setViewState(readPreference());
  }, []);

  const setView = useCallback((v: ViewPreference) => {
    setViewState(v);
    localStorage.setItem(STORAGE_KEY, v);
  }, []);

  return {
    view,
    setView,
    isOwner: view === "owner",
    isStaff: view === "staff",
  };
}
