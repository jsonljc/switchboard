"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
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
  /**
   * Contextual suggestion chips rendered above the input when no action is
   * staged. Each chip stages itself for confirmation when clicked, mirroring
   * the keyboard flow. Empty/undefined hides the row entirely.
   */
  suggestions?: readonly string[];
  /**
   * Optional ⌘K affordance — when supplied the composer renders a small
   * palette button beside the Send control (mirrors the design's secondary
   * palette opener). When omitted no button is rendered.
   */
  onOpenPalette?: () => void;
}

export function Composer({
  placeholder,
  onDispatch,
  halted,
  senderLabel = "ALEX",
  accentColor = T.amber,
  compact = false,
  suggestions,
  onOpenPalette,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<ParsedAction | null>(null);
  // Single parse per keystroke for the live chip preview AND for staging
  // on Enter — avoids parsing twice when the user commits.
  const parsed: ParsedAction | null = useMemo(
    () => (value.trim().length > 0 ? parseCommand(value) : null),
    [value],
  );

  // Halt is sacred. If the operator halts after staging an action, discard
  // the staged action without dispatching — Confirm-after-halt would let a
  // pre-halt instruction cross the halt boundary, which breaks the contract
  // that the input/halt-button enforce together. The Identity row's "Resume"
  // is the only path back to dispatching.
  useEffect(() => {
    if (halted && pending !== null) {
      setPending(null);
    }
  }, [halted, pending]);

  const stage = (action: ParsedAction | null) => {
    if (!action) return;
    setPending(action);
    setValue("");
  };
  const commit = () => {
    if (!pending) return;
    const action = pending;
    setPending(null);
    onDispatch(action);
  };
  const undo = () => setPending(null);

  const stageFromText = (text: string) => {
    stage(parseCommand(text));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      stage(parsed);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (pending) {
        undo();
      } else {
        setValue("");
      }
    }
  };

  const inputDisabled = halted || pending !== null;
  const sendEnabled = parsed !== null && !pending && !halted;

  return (
    <div
      style={{
        borderTop: `1px solid ${T.hair}`,
        background: T.bg,
        padding: compact ? "10px 18px 12px" : "12px 28px 14px",
        flexShrink: 0,
      }}
    >
      {pending ? (
        <div
          data-testid="composer-pending"
          style={{
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            background: T.amberPaper,
            border: `1px solid ${T.amberSoft}`,
            borderRadius: 6,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              color: T.amber,
              fontSize: 14,
              width: 18,
              textAlign: "center",
            }}
          >
            {pending.icon}
          </span>
          <span style={{ fontSize: 13, color: T.ink }}>
            <strong style={{ fontWeight: 600 }}>{pending.label}</strong>
            {pending.detail ? <span style={{ color: T.ink3 }}> · {pending.detail}</span> : null}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={undo}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              color: T.ink3,
              padding: "4px 8px",
              fontFamily: "inherit",
            }}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={commit}
            style={{
              background: T.amber,
              color: "#fff",
              border: `1px solid ${T.amberDeep}`,
              padding: "6px 12px",
              borderRadius: 4,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Confirm
          </button>
        </div>
      ) : null}

      {!pending && suggestions && suggestions.length > 0 ? (
        <div
          data-testid="composer-suggestions"
          style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}
        >
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => stageFromText(s)}
              disabled={halted}
              style={{
                background: "transparent",
                border: `1px solid ${T.hair}`,
                padding: "5px 12px",
                borderRadius: 999,
                fontSize: 12,
                color: halted ? T.ink5 : T.ink3,
                fontFamily: "inherit",
                cursor: halted ? "default" : "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 6,
          padding: "5px 6px 5px 14px",
          opacity: pending ? 0.55 : 1,
          transition: "opacity .15s ease",
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
          disabled={inputDisabled}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            halted
              ? "Halted — resume to send instructions"
              : pending
                ? "Confirm or undo the action above…"
                : placeholder
          }
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
        {parsed && !pending ? (
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
        {onOpenPalette ? (
          <button
            type="button"
            onClick={onOpenPalette}
            title="Open command palette"
            style={{
              background: "transparent",
              border: `1px solid ${T.hair}`,
              padding: "4px 8px",
              borderRadius: 3,
              cursor: "pointer",
              fontFamily: "JetBrains Mono",
              fontSize: 10.5,
              color: T.ink3,
            }}
          >
            ⌘K
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => stage(parsed)}
          disabled={!sendEnabled}
          style={{
            background: sendEnabled ? T.ink : T.ink5,
            color: "#fff",
            border: "none",
            padding: "8px 14px",
            borderRadius: 4,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: sendEnabled ? "pointer" : "default",
            fontFamily: "inherit",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
