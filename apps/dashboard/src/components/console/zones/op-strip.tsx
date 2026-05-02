"use client";

import { useEffect, useState } from "react";
import { useOrgConfig } from "@/hooks/use-org-config";
import { useHaltState } from "../use-halt-state";
import { useToast } from "../use-toast";
import { ZoneSkeleton, ZoneError } from "./zone-states";

const CLOCK_TICK_MS = 15_000;

function fmtClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function fmtDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate().toString().padStart(2, "0")}`;
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function OpStrip({ onHelpOpen }: { onHelpOpen: () => void }) {
  const { data, isLoading, error, refetch } = useOrgConfig();
  const { halted, toggleHalt, setHalted } = useHaltState();
  const { showToast } = useToast();
  const now = useNow(CLOCK_TICK_MS);

  if (isLoading) return <ZoneSkeleton label="Loading op strip" />;
  if (error) return <ZoneError message="Couldn't load org config." onRetry={() => refetch()} />;

  const orgName = data?.config?.name ?? "Switchboard";

  const handleHaltClick = () => {
    const wasHalted = halted;
    toggleHalt();
    showToast({
      title: wasHalted ? "Resumed" : "Halted",
      detail: wasHalted ? "All agents resumed." : "all agents halted — actions queued",
      undoable: true,
      onUndo: () => setHalted(wasHalted),
    });
  };

  return (
    <header className="opstrip">
      <div className="opstrip-row">
        <div className="op-left">
          <span className="brand">Switchboard</span>
          <span className="sep">·</span>
          <span className="org">{orgName}</span>
          <span className="sep">·</span>
          <span>
            {fmtDate(now)} · <time>{fmtClock(now)}</time>
          </span>
        </div>
        <div className="op-right">
          <span className={`op-live${halted ? " halted" : ""}`} role="status">
            <span className="pulse" aria-hidden="true" />
            {halted ? "Halted" : "Live"}
          </span>
          <button
            type="button"
            className="op-help"
            onClick={onHelpOpen}
            title="Keyboard shortcuts (?)"
          >
            ? Help
          </button>
          <button
            type="button"
            className={`op-halt${halted ? " is-halted" : ""}`}
            aria-pressed={halted}
            onClick={handleHaltClick}
            title={halted ? "Resume autonomous agents" : "Pause all autonomous agent actions"}
          >
            {halted ? "Resume" : "Halt"}
          </button>
        </div>
      </div>
    </header>
  );
}
