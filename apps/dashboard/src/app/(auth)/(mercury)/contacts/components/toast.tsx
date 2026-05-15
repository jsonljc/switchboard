"use client";

import { useEffect } from "react";
import styles from "../pipeline.module.css";

export type ToastVariant = "success" | "error";

export function Toast({
  message,
  variant = "success",
  onClose,
}: {
  message: string | null;
  variant?: ToastVariant;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!message || variant === "error") return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [message, variant, onClose]);

  if (!message) return null;
  return (
    <div className={styles.toast} role="status" aria-live="polite" data-variant={variant}>
      {message}
      {variant === "error" && (
        <button onClick={onClose} className={styles.toastDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}
