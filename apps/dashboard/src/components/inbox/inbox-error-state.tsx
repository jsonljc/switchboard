"use client";

import { CloudOff } from "lucide-react";
import { StatePanel } from "@/components/query-states";

export interface InboxErrorStateProps {
  onRetry: () => void;
}

/**
 * Distinct error state for the inbox queue. Never reuses the empty-state copy —
 * an error is an error, not "all clear" (regression guard against isError
 * mis-routing to the empty branch). Built on the shared editorial StatePanel
 * (role="alert", "Couldn't load" eyebrow, amber retry).
 */
export function InboxErrorState({ onRetry }: InboxErrorStateProps) {
  return (
    <StatePanel
      role="alert"
      icon={<CloudOff />}
      eyebrow="Couldn't load"
      title="We couldn't reach your inbox."
      body="Your team is still working in the background. Try again in a moment."
      onRetry={onRetry}
    />
  );
}
