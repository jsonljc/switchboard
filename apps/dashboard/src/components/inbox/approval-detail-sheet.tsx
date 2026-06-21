"use client";

import { useState, useEffect, useId } from "react";
import { AGENT_REGISTRY } from "@switchboard/schemas";
import { relativeTime, undoableFor } from "@/lib/decisions/time";
import { riskChips, confidenceChip } from "@/lib/decisions/risk-chips";
import { formatMoney } from "@/lib/money";
import { needsConfirm } from "@/lib/decisions/swipe-policy";
import { InboxAgentAvatar } from "./inbox-agent-avatar";
import type { Decision, RiskContract } from "@/lib/decisions/types";

// ── Sub-components ────────────────────────────────────────────────────────────

function RiskPill({ contract }: { contract?: RiskContract }) {
  if (!contract)
    return (
      <span className="risk-pill" data-tone="missing">
        needs review
      </span>
    );
  const label =
    contract.riskLevel === "low"
      ? "low risk"
      : contract.riskLevel === "medium"
        ? "medium risk"
        : "high risk";
  return (
    <span className="risk-pill" data-tone={contract.riskLevel}>
      {label}
    </span>
  );
}

interface ConfirmInlineProps {
  agentName: string;
  primaryLabel: string;
  note: string;
  onNote: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmInline({
  agentName,
  primaryLabel,
  note,
  onNote,
  onCancel,
  onConfirm,
}: ConfirmInlineProps) {
  return (
    <div className="ds-confirm">
      <div className="ds-confirm-head">
        <span aria-hidden="true" />
        <span>
          One last check: {agentName}&apos;s {primaryLabel.toLowerCase()}.
        </span>
      </div>
      <textarea
        className="ds-confirm-note"
        rows={2}
        placeholder="Optional: leave a note for the audit log"
        value={note}
        onChange={(e) => onNote(e.target.value)}
      />
      <div className="ds-confirm-actions">
        <button type="button" className="ds-action ds-action-secondary" onClick={onCancel}>
          Not now
        </button>
        <button type="button" className="ds-action ds-action-primary" onClick={onConfirm}>
          Yes, {primaryLabel.toLowerCase()}
        </button>
      </div>
    </div>
  );
}

export interface AlreadyHandledState {
  kind: string;
  label: string;
}

function AlreadyHandledBanner({ state }: { state: AlreadyHandledState }) {
  return (
    <div className="ds-banner" data-state={state.kind}>
      <span aria-hidden="true" />
      <span>{state.label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ApprovalDetailSheetProps {
  decision: Decision;
  nowMs?: number;
  alreadyHandled?: AlreadyHandledState | null;
  onClose: () => void;
  onCommit: (note?: string) => void;
  onSecondary: () => void;
  onDismiss: () => void;
}

export function ApprovalDetailSheet({
  decision,
  nowMs = Date.now(),
  alreadyHandled,
  onClose,
  onCommit,
  onSecondary,
  onDismiss,
}: ApprovalDetailSheetProps) {
  const contract = decision.meta.riskContract;
  // Accessible name for the aria-modal dialog: point at the visible title line
  // ("<agent> needs your okay") so screen readers announce what the dialog is.
  const titleId = useId();
  const mustConfirm = needsConfirm(contract);
  const chips = riskChips(contract);
  const undoableLabel = undoableFor(decision.meta.undoableUntil, nowMs);

  const agentName = AGENT_REGISTRY[decision.agentKey]?.displayName ?? decision.agentKey;

  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    setConfirming(false);
    setNote("");
  }, [decision.id]);

  const handlePrimary = () => {
    if (alreadyHandled) return;
    if (mustConfirm && !confirming) {
      setConfirming(true);
      return;
    }
    onCommit(note.trim() || undefined);
  };

  // Cast dataLines for rendering — on the wire it's string[][]
  const dataLines = decision.presentation.dataLines as unknown as Array<string | string[]>;

  return (
    <div
      className="sheet ds"
      data-agent={decision.agentKey}
      data-kind="approval"
      data-open="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <span className="sheet-handle" />
      <button type="button" className="sheet-close" onClick={onClose} aria-label="Close detail">
        ×
      </button>

      <div className="sheet-body ds-body">
        <header className="ds-head">
          <div className="ds-head-id">
            <InboxAgentAvatar agentKey={decision.agentKey} size={36} />
            <div className="ds-head-id-text">
              <div className="ds-head-line" id={titleId}>
                <span className="ds-head-name" data-agent={decision.agentKey}>
                  {agentName}
                </span>
                <span className="ds-head-needs">needs your okay</span>
              </div>
              <div className="ds-head-meta">
                <span>proposed {relativeTime(decision.createdAt, nowMs)}</span>
                {undoableLabel && (
                  <>
                    <span className="ds-dot">·</span>
                    <span>{undoableLabel}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <RiskPill contract={contract} />
        </header>

        {alreadyHandled && <AlreadyHandledBanner state={alreadyHandled} />}

        <section className="ds-section ds-proposal">
          <div className="ds-eyebrow">The proposal</div>
          <p className="ds-summary">{decision.humanSummary}</p>
          {decision.meta.contactName && (
            <div className="ds-contact-strip">
              <span className="ds-eyebrow-inline">For</span>
              <b>{decision.meta.contactName}</b>
            </div>
          )}
        </section>

        {dataLines.length > 0 && (
          <section className="ds-section ds-evidence">
            <div className="ds-eyebrow">Why {agentName} is recommending this</div>
            <ul className="ds-evidence-list">
              {dataLines.map((line, i) => (
                <li key={i} className="ds-evidence-row">
                  {Array.isArray(line) ? line.join(" · ") : String(line)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {Number.isFinite(decision.meta.dollarsAtRisk) && (decision.meta.dollarsAtRisk ?? 0) > 0 && (
          <section className="ds-section ds-stake">
            <div className="ds-eyebrow">Estimated impact</div>
            <p className="ds-stake-value">{formatMoney(decision.meta.dollarsAtRisk!)}</p>
            <p className="ds-stake-caption">{agentName}&apos;s estimate from recent performance.</p>
          </section>
        )}

        <section className="ds-section ds-risk">
          <div className="ds-eyebrow">Signals</div>
          {!contract ? (
            <div className="ds-risk-missing">
              <span aria-hidden="true" />
              <span>
                Needs review before this can run. This item was logged before risk-tracking was on.
              </span>
            </div>
          ) : (
            <ul className="ds-risk-chips">
              {[...chips, confidenceChip(decision.meta.confidence)].filter(Boolean).map((c) => (
                <li
                  key={c!.key}
                  className="ds-risk-chip"
                  data-tone={c!.strong ? "strong" : c!.soft ? "soft" : "normal"}
                >
                  <span className="ds-risk-chip-bullet" aria-hidden="true" />
                  {c!.label}
                </li>
              ))}
            </ul>
          )}
        </section>

        {decision.threadHref && (
          <a
            className="ds-thread-link"
            href={decision.threadHref}
            onClick={(e) => e.preventDefault()}
          >
            View conversation <span aria-hidden="true">→</span>
          </a>
        )}
      </div>

      <footer className="ds-actions">
        {confirming && !alreadyHandled ? (
          <ConfirmInline
            agentName={agentName}
            primaryLabel={decision.presentation.primaryLabel}
            note={note}
            onNote={setNote}
            onCancel={() => {
              setConfirming(false);
              setNote("");
            }}
            onConfirm={handlePrimary}
          />
        ) : (
          <>
            <button
              type="button"
              className="ds-action ds-action-dismiss"
              onClick={onDismiss}
              disabled={!!alreadyHandled}
            >
              {decision.presentation.dismissLabel || "Dismiss"}
            </button>
            <button
              type="button"
              className="ds-action ds-action-secondary"
              onClick={onSecondary}
              disabled={!!alreadyHandled}
            >
              {decision.presentation.secondaryLabel}
            </button>
            <button
              type="button"
              className="ds-action ds-action-primary"
              onClick={handlePrimary}
              disabled={!!alreadyHandled}
              data-armed={alreadyHandled ? undefined : "ready"}
            >
              {mustConfirm
                ? `${decision.presentation.primaryLabel}…`
                : decision.presentation.primaryLabel}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
