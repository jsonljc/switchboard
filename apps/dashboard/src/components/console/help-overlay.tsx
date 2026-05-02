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
    // Save the previously-focused element so we can restore on close.
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Move focus to the first focusable element inside the card.
    const card = cardRef.current;
    if (card) {
      const first = card.querySelector<HTMLElement>(FOCUSABLE_SELECTORS);
      first?.focus();
    }

    // On unmount: restore focus to the saved element.
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
          <h2 id="help-overlay-title">How Switchboard works</h2>
          <button type="button" className="close" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p>
          Three agents work on your behalf around the clock. <b>Alex</b> handles inbound
          conversations, <b>Nova</b> manages ad spend, and <b>Mira</b> develops creative. They act
          on their own — and stop to ask only when judgment is needed.
        </p>
        <p>
          The <b>Queue</b> at the top is the only thing that needs you. The <b>Agent strip</b> below
          it shows what each one is doing right now. The <b>Activity trail</b> at the bottom is the
          running record.
        </p>
        <div className="keys">
          <kbd>?</kbd>
          <span>Open this help</span>
          <kbd>1 / 2 / 3</kbd>
          <span>Open Alex / Nova / Mira panel</span>
          <kbd>H</kbd>
          <span>Halt or resume all agents</span>
          <kbd>Esc</kbd>
          <span>Close panels & overlays</span>
        </div>
      </div>
    </div>
  );
}
