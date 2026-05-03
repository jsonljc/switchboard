"use client";

// Ships unwired in v1. Wired into <ConsoleView> by Phase 3 (or a small
// follow-up PR). See spec section "Frontend wiring" item 8.

import { useState } from "react";
import { useShadowActions } from "@/hooks/use-shadow-actions";
import { useRecommendationAction } from "@/hooks/use-recommendation-action";

import "./shadow-action-row.css";

export function ShadowActionList() {
  const { data } = useShadowActions();
  const rows = data?.recommendations ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-label="Auto-actions" className="shadow-actions">
      <div className="label">Nova flagged — confirm or undo</div>
      {rows.map((row) => (
        <ShadowActionRow
          key={row.id}
          id={row.id}
          summary={row.humanSummary}
          undoableUntil={row.undoableUntil}
        />
      ))}
    </section>
  );
}

interface RowProps {
  id: string;
  summary: string;
  undoableUntil: string | null;
}

function ShadowActionRow({ id, summary, undoableUntil }: RowProps) {
  const action = useRecommendationAction(id);
  const [error, setError] = useState<string | null>(null);
  const expired = !undoableUntil || new Date(undoableUntil) < new Date();

  const click = async (kind: "confirm" | "undo") => {
    setError(null);
    try {
      await action[kind]();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="shadow-row">
      <div className="summary">{summary}</div>
      {!expired && (
        <div className="actions">
          <button type="button" disabled={action.isPending} onClick={() => click("confirm")}>
            Confirm
          </button>
          <button type="button" disabled={action.isPending} onClick={() => click("undo")}>
            Undo
          </button>
        </div>
      )}
      {error && <div className="row-error">{error}</div>}
    </div>
  );
}
