"use client";

import { Check } from "lucide-react";
import { StatePanel } from "@/components/query-states";

export interface InboxEmptyStateProps {
  /** True when a teammate filter is active (changes the copy to name the agent). */
  filtered: boolean;
  /** Display name of the filtered agent; required when `filtered` is true. */
  agentName?: string;
}

/**
 * Calm empty state for the inbox queue — NOT an error (no eyebrow, status role).
 * When a filter is active the copy names the agent; otherwise it reassures that
 * the team is on top of it. Built on the shared editorial StatePanel; the polling
 * meta line rides the footer slot.
 */
export function InboxEmptyState({ filtered, agentName }: InboxEmptyStateProps) {
  const name = agentName ?? "this teammate";
  return (
    <StatePanel
      icon={<Check />}
      title={filtered ? `Nothing from ${name}.` : "That's everything."}
      body={
        filtered
          ? `${name} doesn't have anything waiting for you. Switch back to All to see the rest of the queue.`
          : "Your team is on top of it. New items will land here as they need a decision."
      }
    >
      Polling · checked just now
    </StatePanel>
  );
}
