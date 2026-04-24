"use client";

import { useState } from "react";
import { OctagonX, Play, Loader2, AlertTriangle, XCircle } from "lucide-react";
import {
  useGovernanceStatus,
  useEmergencyHalt,
  useResume,
  useReadiness,
} from "@/hooks/use-governance";

export function EmergencyHaltButton() {
  const status = useGovernanceStatus();
  const halt = useEmergencyHalt();
  const resume = useResume();
  const readiness = useReadiness();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  const isPaused = status.data?.deploymentStatus === "paused";

  const blockingFailures =
    readiness.data?.checks.filter((c) => c.blocking && c.status === "fail") ?? [];

  if (!status.data) return null;

  /* ── Paused state ─────────────────────────────────────────── */
  if (isPaused) {
    return (
      <div
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Alex is paused
            </p>
            {status.data.haltReason && (
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                {status.data.haltReason}
              </p>
            )}
            {status.data.haltedAt && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Since {new Date(status.data.haltedAt).toLocaleString()}
              </p>
            )}

            {blockingFailures.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  Fix before resuming:
                </p>
                <ul className="mt-1 space-y-1">
                  {blockingFailures.map((check) => (
                    <li key={check.id} className="flex items-center gap-1.5 text-xs text-red-600">
                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                      {check.label}: {check.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              disabled={blockingFailures.length > 0 || resume.isPending}
              onClick={() => resume.mutateAsync()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resume.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Resume Alex
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Confirmation state ───────────────────────────────────── */
  if (confirming) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-700 dark:bg-red-950">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">
          This will immediately pause Alex and stop all automated responses. Are you sure?
        </p>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="mt-3 w-full rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-900 placeholder:text-red-400 focus:outline-none focus:ring-2 focus:ring-red-500 dark:border-red-700 dark:bg-red-900 dark:text-red-100 dark:placeholder:text-red-500"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={halt.isPending}
            onClick={async () => {
              await halt.mutateAsync(reason || undefined);
              setConfirming(false);
              setReason("");
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {halt.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <OctagonX className="h-4 w-4" />
            )}
            Confirm Stop
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setReason("");
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-600 dark:text-red-300 dark:hover:bg-red-900"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  /* ── Active state ─────────────────────────────────────────── */
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
    >
      <OctagonX className="h-4 w-4" />
      Emergency Stop
    </button>
  );
}
