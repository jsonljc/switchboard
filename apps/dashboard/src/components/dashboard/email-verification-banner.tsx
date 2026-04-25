"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

export function EmailVerificationBanner() {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleResend = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/dashboard/auth/resend-verification", { method: "POST" });
      if (res.ok) {
        setSent(true);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        marginTop: "24px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "14px 20px",
        background: "hsl(35, 80%, 14%)",
        border: "1px solid hsl(35, 60%, 28%)",
        borderRadius: "10px",
        flexWrap: "wrap",
      }}
    >
      <AlertTriangle
        style={{ width: "18px", height: "18px", color: "hsl(35, 80%, 55%)", flexShrink: 0 }}
      />
      <p
        style={{
          flex: 1,
          fontSize: "14px",
          color: "hsl(35, 50%, 80%)",
          margin: 0,
          minWidth: "200px",
        }}
      >
        Verify your email to go live.{" "}
        <span style={{ color: "hsl(35, 30%, 60%)" }}>
          Check your inbox for a verification link.
        </span>
      </p>
      {sent ? (
        <span style={{ fontSize: "13px", color: "hsl(145, 45%, 55%)" }}>Sent!</span>
      ) : (
        <button
          type="button"
          onClick={handleResend}
          disabled={sending}
          style={{
            padding: "6px 16px",
            borderRadius: "8px",
            border: "1px solid hsl(35, 60%, 28%)",
            background: "transparent",
            color: "hsl(35, 80%, 55%)",
            fontSize: "13px",
            fontWeight: 500,
            cursor: sending ? "not-allowed" : "pointer",
            opacity: sending ? 0.6 : 1,
          }}
        >
          {sending ? "Sending..." : "Resend verification email"}
        </button>
      )}
    </div>
  );
}
