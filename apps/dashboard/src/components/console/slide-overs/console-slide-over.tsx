"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

interface ConsoleSlideOverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

/**
 * Shared slide-over surface for /console queue actions.
 *
 * Used by <ApprovalSlideOver> and <EscalationSlideOver>. Renders as a
 * right-edge panel using Radix Dialog primitives — Radix handles focus
 * trap, escape-to-close, click-outside-to-close, and body-scroll-lock.
 */
export function ConsoleSlideOver({ open, onOpenChange, title, children }: ConsoleSlideOverProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto bg-background p-6 shadow-xl"
          data-v6-console
        >
          <header className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="rounded p-1 hover:bg-muted">
              ✕
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
