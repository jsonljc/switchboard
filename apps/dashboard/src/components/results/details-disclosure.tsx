"use client";

import { useState } from "react";
import styles from "./results.module.css";

/**
 * Collapse/expand wrapper for all depth below the hero (funnel, campaigns,
 * managed-comparison). Supports controlled (open + onToggle) and uncontrolled
 * (self-managed useState) use.
 */
export function DetailsDisclosure({
  open,
  onToggle,
  children,
}: {
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(false);

  // Controlled when both open (boolean) and onToggle are provided.
  const isControlled = typeof open === "boolean" && typeof onToggle === "function";
  const isOpen = isControlled ? open : internalOpen;

  function handleToggle() {
    if (isControlled) {
      onToggle!();
    } else {
      setInternalOpen((prev) => !prev);
    }
  }

  return (
    <div className={styles.disclosure}>
      <hr className={styles.disclosureRule} />
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={handleToggle}
        className={styles.disclosureToggle}
      >
        <span>{isOpen ? "Hide the details" : "See the details"}</span>
        <span className={styles.disclosureCaret} aria-hidden="true">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>
      {isOpen && <div className={styles.disclosureContent}>{children}</div>}
    </div>
  );
}
