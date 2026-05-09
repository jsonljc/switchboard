// apps/dashboard/src/components/layout/help-overlay.tsx
"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTORS = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const card = cardRef.current;
    if (card) {
      const first = card.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      first?.focus();
    }

    return () => {
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        className="help-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-overlay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="head-row">
          <h2 id="help-overlay-title" className="font-display">
            Quick reference
          </h2>
          <button type="button" className="close" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p>
          Three agents work on your behalf. The <b>Inbox</b> shows decisions that need you. Each
          agent has a home page with their own work. <b>Live</b> in the header is the system pulse —
          open it to halt or resume everyone, or to glance at recent activity.
        </p>
        <div className="keys">
          <kbd>?</kbd>
          <span>Open this reference</span>
          <kbd>H</kbd>
          <span>Halt or resume all agents</span>
          <kbd>Esc</kbd>
          <span>Close this reference</span>
        </div>
      </div>
    </div>
  );
}
