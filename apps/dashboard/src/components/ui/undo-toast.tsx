"use client";

import { useEffect, useState } from "react";
import { ToastAction } from "@/components/ui/toast";

// When there's no undo window on the wire, give the toast a finite, sane lifetime
// rather than the old 16-minute ghost.
const UNDO_FALLBACK_MS = 8000;
// Floor so a near-closed window still flashes briefly instead of vanishing instantly.
const UNDO_MIN_MS = 2500;

function remainingMs(undoableUntil: string | undefined, now: number): number {
  if (!undoableUntil) return UNDO_FALLBACK_MS;
  const ms = new Date(undoableUntil).getTime() - now;
  return ms > 0 ? ms : 0;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/**
 * A live countdown of how long the just-approved action can still be undone,
 * bound to the recommendation's undoableUntil. Renders nothing when the wire
 * carries no undo window.
 */
export function UndoCountdown({ undoableUntil }: { undoableUntil?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!undoableUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [undoableUntil]);

  if (!undoableUntil) return null;
  return (
    <span
      className="toast-undo-countdown"
      style={{ fontVariantNumeric: "tabular-nums", opacity: 0.7 }}
    >
      Undoable for {formatRemaining(remainingMs(undoableUntil, now))}
    </span>
  );
}

export interface UndoToastInput {
  contactName?: string;
  /** ISO string from decision.meta.undoableUntil. */
  undoableUntil?: string;
  onUndo: () => void;
}

/**
 * Build the props for a branded undo toast (a real safety net): a live countdown
 * bound to the undo window, the Undo action, and a `duration` that auto-dismisses
 * the toast exactly when undo is no longer possible — so there's never a dead Undo
 * button lingering. Pass the result straight to `toast(...)`.
 */
export function undoToastProps({ contactName, undoableUntil, onUndo }: UndoToastInput) {
  return {
    className: "toast-undo",
    title: "Approved",
    description: (
      <span className="toast-undo-body">
        {contactName ? `Sent for ${contactName}. ` : ""}
        <UndoCountdown undoableUntil={undoableUntil} />
      </span>
    ),
    duration: Math.max(remainingMs(undoableUntil, Date.now()), UNDO_MIN_MS),
    action: (
      <ToastAction altText="Undo" onClick={onUndo}>
        Undo
      </ToastAction>
    ),
  };
}
