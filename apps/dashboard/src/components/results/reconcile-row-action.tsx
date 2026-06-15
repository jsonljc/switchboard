"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AttributionConfidence, ReceiptedBookingWorklistItem } from "@switchboard/schemas";
import { createIdempotencyKey } from "@/lib/idempotency";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import styles from "./results.module.css";

/** The five attribution-confidence rungs, strongest to weakest. */
const CONFIDENCE_OPTIONS: ReadonlyArray<{ value: AttributionConfidence; label: string }> = [
  { value: "deterministic", label: "Deterministic" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "unattributed", label: "Unattributed" },
];

type FormState = "idle" | "override" | "flag" | "pending" | "error";

interface Props {
  row: ReceiptedBookingWorklistItem;
  /** Called after any successful reconcile action so the parent can refresh. */
  onReconciled?: () => void;
}

/**
 * Compact per-row action control for the proof-quality worklist. Three actions:
 *   - "Fix attribution" (override_attribution): always available; mints the row if absent.
 *   - "Flag duplicate" (flag_duplicate): gated on row.issuedAt != null.
 *   - "Dismiss" (resolve_exception, code duplicate_contact_risk): gated on issuedAt != null.
 * missing_consent rows surface a link to the consent flow, not a resolve button (PDPA).
 */
export function ReconcileRowAction({ row, onReconciled }: Props) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();

  const [formState, setFormState] = useState<FormState>("idle");
  const [confidence, setConfidence] = useState<AttributionConfidence>(row.attributionConfidence);
  const [reason, setReason] = useState("");
  const [flagDetail, setFlagDetail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasMissingConsent = row.openExceptionCodes.includes("missing_consent");
  const hasDuplicateRisk = row.openExceptionCodes.includes("duplicate_contact_risk");
  const hasIssuedRow = row.issuedAt != null;

  function handleReconcileSuccess(): void {
    if (keys) {
      void queryClient.invalidateQueries({ queryKey: keys.reports.all() });
    }
    onReconciled?.();
  }

  async function postReconcile(body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`/api/dashboard/bookings/${row.bookingId}/reconcile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": createIdempotencyKey(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Request failed (HTTP ${res.status})`);
    }
  }

  async function handleOverrideSubmit() {
    if (!reason.trim()) return;
    setFormState("pending");
    setErrorMsg(null);
    try {
      await postReconcile({ action: "override_attribution", confidence, reason: reason.trim() });
      setFormState("idle");
      setReason("");
      handleReconcileSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setFormState("error");
    }
  }

  async function handleFlagSubmit() {
    if (!flagDetail.trim()) return;
    setFormState("pending");
    setErrorMsg(null);
    try {
      await postReconcile({ action: "flag_duplicate", detail: flagDetail.trim() });
      setFormState("idle");
      setFlagDetail("");
      handleReconcileSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setFormState("error");
    }
  }

  async function handleDismiss() {
    setFormState("pending");
    setErrorMsg(null);
    try {
      await postReconcile({ action: "resolve_exception", code: "duplicate_contact_risk" });
      setFormState("idle");
      handleReconcileSuccess();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setFormState("error");
    }
  }

  const isPending = formState === "pending";

  return (
    <div className={styles.reconcileRowAction}>
      {formState === "override" && (
        <div className={styles.reconcileForm}>
          <label className={styles.reconcileLabel}>
            {"Attribution confidence"}
            <select
              className={styles.reconcileSelect}
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as AttributionConfidence)}
              disabled={isPending}
            >
              {CONFIDENCE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <input
            className={styles.reconcileInput}
            type="text"
            placeholder="Reason (e.g. owner knows the source)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
          />
          <div className={styles.reconcileActions}>
            <button
              className={styles.reconcileSubmit}
              onClick={() => void handleOverrideSubmit()}
              disabled={isPending || !reason.trim()}
            >
              {"Confirm"}
            </button>
            <button
              className={styles.reconcileCancel}
              onClick={() => {
                setFormState("idle");
                setReason("");
              }}
              disabled={isPending}
            >
              {"Cancel"}
            </button>
          </div>
        </div>
      )}

      {formState === "flag" && (
        <div className={styles.reconcileForm}>
          <input
            className={styles.reconcileInput}
            type="text"
            placeholder="Note (e.g. same phone as another booking)"
            value={flagDetail}
            onChange={(e) => setFlagDetail(e.target.value)}
            disabled={isPending}
          />
          <div className={styles.reconcileActions}>
            <button
              className={styles.reconcileSubmit}
              onClick={() => void handleFlagSubmit()}
              disabled={isPending || !flagDetail.trim()}
            >
              {"Confirm flag"}
            </button>
            <button
              className={styles.reconcileCancel}
              onClick={() => {
                setFormState("idle");
                setFlagDetail("");
              }}
              disabled={isPending}
            >
              {"Cancel"}
            </button>
          </div>
        </div>
      )}

      {formState !== "override" && formState !== "flag" && (
        <div className={styles.reconcileButtons}>
          <button
            className={styles.reconcileAction}
            onClick={() => setFormState("override")}
            disabled={isPending}
          >
            {"Fix attribution"}
          </button>

          {hasIssuedRow && !hasDuplicateRisk && (
            <button
              className={styles.reconcileAction}
              onClick={() => setFormState("flag")}
              disabled={isPending}
            >
              {"Flag duplicate"}
            </button>
          )}

          {hasIssuedRow && hasDuplicateRisk && (
            <button
              className={styles.reconcileAction}
              onClick={() => void handleDismiss()}
              disabled={isPending}
            >
              {"Dismiss"}
            </button>
          )}

          {hasMissingConsent && (
            <span className={styles.reconcileConsentNote}>
              {"Record consent on the contact's profile."}
            </span>
          )}
        </div>
      )}

      {(formState === "error" || errorMsg) && (
        <p className={styles.reconcileError}>{errorMsg ?? "Something went wrong."}</p>
      )}
    </div>
  );
}
