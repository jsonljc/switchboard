"use client";

import { useHalt } from "./halt-context";

export function HaltButtonClient() {
  const { halted, toggleHalt } = useHalt();
  return (
    <button
      type="button"
      className={`folio-link ${halted ? "is-halt" : ""}`}
      aria-pressed={halted}
      onClick={toggleHalt}
    >
      {halted ? "Halted" : "Halt"}
    </button>
  );
}
