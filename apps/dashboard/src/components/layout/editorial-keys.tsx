// apps/dashboard/src/components/layout/editorial-keys.tsx
"use client";

import { useState } from "react";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { useHalt } from "./halt/halt-context";
import { HelpOverlay } from "./help-overlay";

export function EditorialKeys() {
  const [helpOpen, setHelpOpen] = useState(false);
  const { toggleHalt } = useHalt();

  useKeyboardShortcuts({
    help: () => setHelpOpen((v) => !v),
    halt: toggleHalt,
    escape: () => setHelpOpen(false),
  });

  return helpOpen ? <HelpOverlay onClose={() => setHelpOpen(false)} /> : null;
}
