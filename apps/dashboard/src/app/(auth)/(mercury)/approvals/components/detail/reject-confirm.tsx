"use client";

import { useState } from "react";
import detailStyles from "../../detail.module.css";

export interface RejectConfirmProps {
  onConfirm: () => void;
  disabled?: boolean;
}

/**
 * Two-step inline reject. v1 has no reason textarea — the API doesn't
 * persist a reason and a non-persisted note would mislead operators
 * (amendment from spec review).
 */
export function RejectConfirm({ onConfirm, disabled }: RejectConfirmProps) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <div className={detailStyles.rejectRow}>
        <span className={detailStyles.rejectRowText}>Don't approve this action.</span>
        <button
          type="button"
          className={detailStyles.rejectBtn}
          onClick={() => setArmed(true)}
          disabled={disabled}
        >
          Reject
        </button>
      </div>
    );
  }

  return (
    <div className={detailStyles.rejectRow}>
      <span className={detailStyles.rejectRowText}>Are you sure?</span>
      <button type="button" className={detailStyles.btnSm} onClick={() => setArmed(false)}>
        Cancel
      </button>
      <button
        type="button"
        className={detailStyles.rejectBtnConfirm}
        onClick={onConfirm}
        disabled={disabled}
      >
        Confirm reject
      </button>
    </div>
  );
}
