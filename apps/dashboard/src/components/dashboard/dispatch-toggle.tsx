"use client";

import { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { useGovernanceStatus, useEmergencyHalt, useResume } from "@/hooks/use-governance";

/**
 * Lightweight pause/unpause toggle for skill dispatch.
 * Unlike EmergencyHaltButton (red, scary), this is a friendly on/off switch
 * for operators who want to temporarily disable automated actions without
 * triggering a full emergency halt UX.
 *
 * Under the hood it uses the same governance halt/resume endpoints.
 */
export function DispatchToggle() {
  const status = useGovernanceStatus();
  const halt = useEmergencyHalt();
  const resume = useResume();
  const [busy, setBusy] = useState(false);

  if (!status.data) return null;

  const isPaused = status.data.deploymentStatus === "paused";
  const pending = busy || halt.isPending || resume.isPending;

  const handleToggle = async () => {
    setBusy(true);
    try {
      if (isPaused) {
        await resume.mutateAsync();
      } else {
        await halt.mutateAsync("Paused via dashboard toggle");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        background: "var(--sw-surface-raised)",
        border: "1px solid var(--sw-border)",
        borderRadius: "10px",
      }}
    >
      <div style={{ flex: 1 }}>
        <p
          style={{
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--sw-text-primary)",
            margin: 0,
          }}
        >
          Skill Dispatch
        </p>
        <p
          style={{
            fontSize: "13px",
            color: isPaused ? "hsl(0, 50%, 50%)" : "hsl(145, 45%, 42%)",
            margin: "2px 0 0",
          }}
        >
          {isPaused ? "Paused" : "Active"}
        </p>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={handleToggle}
        aria-label={isPaused ? "Resume skill dispatch" : "Pause skill dispatch"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 14px",
          borderRadius: "8px",
          border: "1px solid var(--sw-border)",
          background: isPaused ? "hsl(145, 45%, 42%)" : "var(--sw-surface)",
          color: isPaused ? "#fff" : "var(--sw-text-primary)",
          fontSize: "13px",
          fontWeight: 500,
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.6 : 1,
          transition: "all 150ms ease",
        }}
      >
        {pending ? (
          <Loader2
            style={{ width: "14px", height: "14px", animation: "spin 1s linear infinite" }}
          />
        ) : isPaused ? (
          <Play style={{ width: "14px", height: "14px" }} />
        ) : (
          <Pause style={{ width: "14px", height: "14px" }} />
        )}
        {isPaused ? "Resume" : "Pause"}
      </button>
    </div>
  );
}
