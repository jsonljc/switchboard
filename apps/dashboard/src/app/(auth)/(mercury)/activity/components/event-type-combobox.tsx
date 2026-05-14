"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../activity.module.css";

export type EventTypeBands = Readonly<Record<string, ReadonlyArray<string>>>;

export interface EventTypeComboboxProps {
  /** Selected event type, or null when none chosen. */
  value: string | null;
  /** Band-grouped event-type catalogue. Insertion order is preserved. */
  bands: EventTypeBands;
  /** Page-local counts keyed by event type. Missing keys treated as 0. */
  counts: Readonly<Record<string, number>>;
  onChange: (next: string | null) => void;
}

interface FlatOption {
  band: string;
  et: string;
}

/**
 * Simplified-v1 banded combobox (spec §5.2).
 *
 * - Non-sticky band headers (sticky headers / match highlighting / band
 *   descriptions are deferred to a shared primitive per spec §5.2).
 * - Each option suffixes a `· N on this page` count.
 * - Substring filter on type; band headers drop out of filtered view.
 * - Keyboard: ↑/↓ move highlight, Enter selects, Esc closes.
 * - Click outside closes.
 *
 * WAI-ARIA combobox-with-listbox pattern (spec §8): input has role=combobox
 * with aria-expanded / aria-controls / aria-activedescendant; popover is
 * role=listbox; options are role=option with aria-selected.
 */
export function EventTypeCombobox({ value, bands, counts, onChange }: EventTypeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = "activity-event-type-listbox";

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const flat = useMemo<FlatOption[]>(() => {
    const items: FlatOption[] = [];
    for (const [band, list] of Object.entries(bands)) {
      for (const et of list) items.push({ band, et });
    }
    return items;
  }, [bands]);

  const filtered = useMemo<FlatOption[] | null>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return flat.filter((i) => i.et.toLowerCase().includes(q));
  }, [query, flat]);

  useEffect(() => {
    setHighlight(-1);
  }, [filtered, open]);

  const visibleOptions = useMemo<FlatOption[]>(() => filtered ?? flat, [filtered, flat]);

  const pick = useCallback(
    (et: string) => {
      onChange(et);
      setOpen(false);
      setQuery("");
    },
    [onChange],
  );

  const clear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange(null);
      setQuery("");
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowDown") {
        setHighlight((h) => Math.min(visibleOptions.length - 1, h + 1));
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp") {
        setHighlight((h) => Math.max(0, h - 1));
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        if (highlight >= 0 && highlight < visibleOptions.length) {
          pick(visibleOptions[highlight]!.et);
        }
        e.preventDefault();
      }
    },
    [open, highlight, visibleOptions, pick],
  );

  const renderedOption = (et: string, idx: number) => {
    const isSelected = value === et;
    const isHighlighted = highlight === idx;
    const className = [
      styles.comboOpt,
      isSelected ? styles.comboOptSelected : "",
      isHighlighted ? styles.comboOptActive : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <button
        key={et}
        id={`act-combo-opt-${idx}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={className}
        onClick={() => pick(et)}
        onMouseEnter={() => setHighlight(idx)}
      >
        <span>{et}</span>
        <span className={styles.comboOptCount}>· {counts[et] ?? 0} on this page</span>
      </button>
    );
  };

  // Grouped view: maintain a running index across bands so keyboard nav uses
  // the same indexing as the flat view.
  const groupedView = (() => {
    let idx = -1;
    return Object.entries(bands).map(([band, list]) => (
      <div key={band} role="presentation">
        <div role="presentation" className={styles.comboBand}>
          {band}
        </div>
        {list.map((et) => {
          idx += 1;
          return renderedOption(et, idx);
        })}
      </div>
    ));
  })();

  return (
    <>
      <span className={styles.filterStripEyebrow}>event</span>
      <div className={styles.combo} ref={wrapRef}>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && highlight >= 0 ? `act-combo-opt-${highlight}` : undefined}
          className={styles.comboInput}
          placeholder="event type — type to filter…"
          value={open ? query : (value ?? "")}
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        {value && !open && (
          <button
            type="button"
            className={styles.comboClear}
            aria-label="clear event type"
            onClick={clear}
          >
            ×
          </button>
        )}
        <span className={styles.comboCaret} aria-hidden="true">
          ▾
        </span>
        {open && (
          <div className={styles.comboPop} id={listboxId} role="listbox">
            {filtered ? (
              filtered.length === 0 ? (
                <div className={styles.comboEmpty}>No event type matches “{query}”.</div>
              ) : (
                filtered.map((opt, idx) => renderedOption(opt.et, idx))
              )
            ) : (
              groupedView
            )}
          </div>
        )}
      </div>
    </>
  );
}
