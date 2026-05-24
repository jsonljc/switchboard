// apps/dashboard/src/components/layout/live-signal-popover.tsx
"use client";

import { useState, useEffect } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useHalt } from "./halt/halt-context";
import { useAudit, type AuditEntryResponse } from "@/hooks/use-audit";
import { useToast } from "@/components/ui/use-toast";
import "./live-signal-popover.css";

const RECENT_LIMIT = 10;

type AgentTag = "alex" | "riley" | "mira" | "system";

function agentTagFromActor(entry: AuditEntryResponse): AgentTag {
  const key = `${entry.actorId ?? ""} ${entry.eventType ?? ""}`.toLowerCase();
  if (key.includes("alex")) return "alex";
  if (key.includes("riley")) return "riley";
  if (key.includes("mira")) return "mira";
  return "system";
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function humanizeEventType(eventType: string): string {
  return eventType.replace(/^[^.]+\./, "").replace(/[._]/g, " ");
}

function formatHHMM(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function rowLabel(entry: AuditEntryResponse): string {
  const summary = entry.summary?.trim();
  if (summary) return summary;
  return humanizeEventType(entry.eventType);
}

function EventRow({ entry }: { entry: AuditEntryResponse }) {
  const tag = agentTagFromActor(entry);
  return (
    <li className="event-row" data-agent={tag}>
      <span className="event-time">{formatHHMM(entry.timestamp)}</span>
      <span className="event-agent">{capitalize(tag)}</span>
      <span className="event-msg">{rowLabel(entry)}</span>
    </li>
  );
}

export function LiveSignalPopover() {
  const [open, setOpen] = useState(false);
  const { halted, toggleHalt, error } = useHalt();
  const { toast } = useToast();
  const { data, isLoading, isError } = useAudit();

  // Surface resume-readiness blockers (C1→C2 loop) to the operator as a toast.
  // Fires once when a new error appears; guard prevents firing on null.
  useEffect(() => {
    if (!error) return;
    toast({
      title: halted ? "Couldn't resume" : "Couldn't pause",
      description: error.message,
      variant: "destructive",
    });
  }, [error]); // re-fires per failure: use-governance throws a fresh Error instance on each failed resume (new identity); see halt-context lastAction gating — toast is stable, omitting it is safe and avoids re-fire on rerender

  // The audit endpoint can return HTTP 200 with a `data.error` string when the
  // upstream API is unreachable (see use-audit.ts). React Query's `isError`
  // doesn't catch that case, so widen the surface here — silently rendering
  // "Nothing to report" while the backend is down would mislead the operator.
  const showError = isError || Boolean(data?.error);

  const entries = (data?.entries ?? [])
    .slice() // don't mutate React Query cache
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, RECENT_LIMIT);

  const stateLabel = halted ? "Halted" : "Live";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`live-pip${halted ? " halted" : ""}`}
          aria-label={`System ${stateLabel.toLowerCase()} — open live signal`}
          aria-expanded={open}
        >
          <span className="pulse" aria-hidden="true" />
          {stateLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        role="dialog"
        aria-label="Live signal"
        className="live-popover"
        sideOffset={8}
      >
        <header className="live-popover-head">
          <span className={`status-dot${halted ? " halted" : ""}`} aria-hidden="true" />
          <span className="status-label font-display">System {stateLabel.toLowerCase()}</span>
          <button type="button" className="halt-action" onClick={toggleHalt} aria-pressed={halted}>
            {halted ? "Resume" : "Halt"}
          </button>
        </header>
        <section className="recent-events" aria-label="Recent activity">
          {isLoading && (
            <p className="muted-state">
              <em>Reading the trail…</em>
            </p>
          )}
          {!isLoading && showError && (
            <p className="muted-state">
              <em>Couldn&apos;t load activity.</em>
            </p>
          )}
          {!isLoading && !showError && entries.length === 0 && (
            <p className="muted-state">
              <em>Nothing to report.</em>
            </p>
          )}
          {!isLoading && !showError && entries.length > 0 && (
            <ul className="event-list">
              {entries.map((e) => (
                <EventRow key={e.id} entry={e} />
              ))}
            </ul>
          )}
        </section>
        <footer className="shortcut-hint">
          <kbd>?</kbd> shortcuts · <kbd>Esc</kbd> close
        </footer>
      </PopoverContent>
    </Popover>
  );
}
