"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { T } from "./tokens";
import type { Command, CommandGroup, ThreadContext } from "./types";

// Order: control → thread → rules → nav. The palette's primary job is
// "tell Alex what to do" — operational commands lead. Nav routes away
// from the cockpit, so it's last. Do not reorder.
const GROUP_ORDER: CommandGroup[] = ["control", "thread", "rules", "nav"];
const GROUP_LABEL: Record<CommandGroup, string> = {
  control: "Control",
  thread: "Thread",
  rules: "Rules",
  nav: "Navigate",
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: readonly Command[];
  onSelect: (command: Command) => void;
  threadContext?: ThreadContext;
  placeholder?: string;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  onSelect,
  threadContext,
  placeholder = "Type a command…",
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFocusIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tokens = q.length === 0 ? [] : q.split(/\s+/);
    const matchesQuery = (c: Command) => {
      if (tokens.length === 0) return true;
      const hay = `${c.label.toLowerCase()} ${c.id.toLowerCase()}`;
      return tokens.every((t) => hay.includes(t));
    };
    const isEnabled = (c: Command) => c.group !== "thread" || threadContext !== undefined;
    const byGroup = new Map<CommandGroup, Command[]>();
    for (const c of commands) {
      if (!matchesQuery(c)) continue;
      const arr = byGroup.get(c.group) ?? [];
      arr.push(c);
      byGroup.set(c.group, arr);
    }
    const flat: { cmd: Command; enabled: boolean }[] = [];
    for (const g of GROUP_ORDER) {
      const arr = byGroup.get(g) ?? [];
      for (const cmd of arr) flat.push({ cmd, enabled: isEnabled(cmd) });
    }
    return { byGroup, flat };
  }, [commands, query, threadContext]);

  if (!open) return null;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIndex((i) => Math.min(i + 1, Math.max(filtered.flat.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered.flat[focusIndex];
      if (entry && entry.enabled) onSelect(entry.cmd);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onKeyDown={handleKeyDown}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(14,12,10,0.18)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 72,
        zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "92vw",
          background: T.bg,
          border: `1px solid ${T.hair}`,
          borderRadius: 8,
          boxShadow: "0 12px 32px rgba(14,12,10,0.18)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          role="searchbox"
          aria-label="Filter commands"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocusIndex(0);
          }}
          style={{
            width: "100%",
            padding: "14px 18px",
            border: "none",
            borderBottom: `1px solid ${T.hair}`,
            background: T.bg,
            color: T.ink,
            fontSize: 14,
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 8,
            maxHeight: 360,
            overflowY: "auto",
          }}
        >
          {GROUP_ORDER.map((group) => {
            const entries = filtered.byGroup.get(group) ?? [];
            if (entries.length === 0) return null;
            return (
              <li key={group} style={{ padding: "6px 0" }}>
                <div
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    color: T.ink4,
                    textTransform: "uppercase",
                  }}
                >
                  {GROUP_LABEL[group]}
                </div>
                {entries.map((cmd) => {
                  const flatIndex = filtered.flat.findIndex((e) => e.cmd.id === cmd.id);
                  const focused = flatIndex === focusIndex;
                  const enabled = filtered.flat[flatIndex]?.enabled ?? false;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      disabled={!enabled}
                      onClick={() => enabled && onSelect(cmd)}
                      onMouseEnter={() => setFocusIndex(flatIndex)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        background: focused ? "rgba(184,120,46,0.08)" : "transparent",
                        border: "none",
                        cursor: enabled ? "pointer" : "not-allowed",
                        fontSize: 13,
                        color: enabled ? T.ink : T.ink4,
                        fontFamily: "inherit",
                        borderRadius: 4,
                      }}
                    >
                      {cmd.label}
                    </button>
                  );
                })}
              </li>
            );
          })}
          {filtered.flat.length === 0 && (
            <li style={{ padding: "16px 14px", color: T.ink4, fontSize: 13 }}>
              No commands match.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
