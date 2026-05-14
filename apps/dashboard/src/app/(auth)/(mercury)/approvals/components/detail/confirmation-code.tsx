"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../../approvals.module.css";

export interface ConfirmationCodeProps {
  bindingHash: string;
  envelopeId: string;
}

export function ConfirmationCode({ bindingHash, envelopeId }: ConfirmationCodeProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function copy() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(bindingHash);
      setStatus("copied");
      timerRef.current = setTimeout(() => setStatus("idle"), 1400);
    } catch {
      setStatus("failed");
      timerRef.current = setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <span className={styles.eyebrow}>Confirmation code · locks in the details above</span>
      </div>
      <div className={styles.codeRow}>
        <span className={styles.codeValue} data-testid="confirmation-code-value">
          {bindingHash}
        </span>
        <button type="button" className={styles.codeCopyBtn} onClick={copy}>
          {status === "copied"
            ? "Copied"
            : status === "failed"
              ? "Couldn't copy — select and copy manually"
              : "Copy code"}
        </button>
        <span className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
          {status === "copied"
            ? "Confirmation code copied."
            : status === "failed"
              ? "Copy failed. Select the code and copy manually."
              : ""}
        </span>
      </div>
      <div className={styles.codeFoot}>
        This code matches the exact details above. If any detail changes, the code changes. If
        something looks off, reject this and the agent can propose a corrected version.
      </div>
      <div className={styles.codeRef}>
        Reference: <span className={styles.codeRefId}>{envelopeId}</span>
      </div>
    </div>
  );
}
