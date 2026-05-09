"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../contacts.module.css";

const DEBOUNCE_MS = 200;

export interface SearchInputProps {
  initialValue?: string;
  onCommit: (next: string) => void;
  /** Override the debounce in tests. */
  debounceMs?: number;
}

export function SearchInput({
  initialValue = "",
  onCommit,
  debounceMs = DEBOUNCE_MS,
}: SearchInputProps) {
  const [value, setValue] = useState(initialValue);
  const lastCommittedRef = useRef(initialValue);

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastCommittedRef.current) return;
    const handle = setTimeout(() => {
      lastCommittedRef.current = trimmed;
      onCommit(trimmed);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [value, debounceMs, onCommit]);

  return (
    <div className={styles.searchWrap}>
      <input
        type="search"
        className={styles.searchInput}
        placeholder="Search name, phone, or email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Search contacts"
      />
    </div>
  );
}
