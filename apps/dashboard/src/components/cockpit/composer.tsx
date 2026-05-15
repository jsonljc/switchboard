"use client";

import { useState, type KeyboardEvent } from "react";
import { T } from "./tokens";
import { parseCommand } from "@/lib/cockpit/parse-command";
import type { ParsedAction } from "./types";

export interface ComposerProps {
  placeholder: string;
  onDispatch: (action: ParsedAction) => void;
  halted: boolean;
  senderLabel?: string;
  accentColor?: string;
  compact?: boolean;
}

export function Composer({
  placeholder,
  onDispatch,
  halted,
  senderLabel = "ALEX",
  accentColor = T.amber,
  compact = false,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const parsed: ParsedAction | null = value.trim().length > 0 ? parseCommand(value) : null;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim().length === 0) return;
      const action = parseCommand(value);
      setValue("");
      onDispatch(action);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
    }
  };

  return (
    <div
      style={{
        borderTop: `1px solid ${T.hair}`,
        background: T.bg,
        padding: compact ? "10px 18px 12px" : "12px 28px 14px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 6,
          padding: "5px 14px",
          opacity: halted ? 0.55 : 1,
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono",
            fontSize: 11,
            color: accentColor,
            letterSpacing: "0.08em",
          }}
        >
          → {senderLabel}
        </span>
        <input
          type="text"
          role="textbox"
          aria-label="Composer input"
          disabled={halted}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={halted ? "Halted — resume to send instructions" : placeholder}
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            outline: "none",
            fontSize: 13,
            color: T.ink,
            padding: "8px 0",
            fontFamily: "inherit",
          }}
        />
        {parsed ? (
          <span
            data-testid="composer-chip"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "JetBrains Mono",
              fontSize: 11,
              color: T.ink3,
              background: T.bg,
              border: `1px solid ${T.hair}`,
              borderRadius: 3,
              padding: "2px 6px",
              whiteSpace: "nowrap",
            }}
          >
            <span>{parsed.icon}</span>
            <span>{parsed.label}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
