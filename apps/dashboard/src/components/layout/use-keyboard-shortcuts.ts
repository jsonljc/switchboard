"use client";

import { useEffect } from "react";

export type KeyboardShortcutHandlers = Partial<{
  help: () => void;
  halt: () => void;
  escape: () => void;
}>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  if (target.contentEditable === "true") return true;
  return false;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        if (handlers.help) {
          e.preventDefault();
          handlers.help();
        }
        return;
      }
      if (e.key === "h" || e.key === "H") {
        if (handlers.halt) handlers.halt();
        return;
      }
      if (e.key === "Escape") {
        if (handlers.escape) handlers.escape();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}
