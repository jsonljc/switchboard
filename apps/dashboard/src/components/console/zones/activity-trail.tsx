"use client";

import Link from "next/link";
import { useAudit, type AuditEntryResponse } from "@/hooks/use-audit";
import { ZoneEmpty, ZoneError, ZoneSkeleton } from "./zone-states";

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function humanizeEventType(eventType: string): string {
  // Strip a leading "namespace." prefix and replace separators with spaces.
  return eventType.replace(/^[^.]+\./, "").replace(/[._]/g, " ");
}

function formatHHMM(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function agentForEntry(entry: AuditEntryResponse): string {
  const key = (entry.actorId ?? entry.eventType ?? "").toLowerCase();
  if (key.includes("alex")) return "alex";
  if (key.includes("nova")) return "nova";
  if (key.includes("mira")) return "mira";
  return "system";
}

function rowLabel(entry: AuditEntryResponse): string {
  const summary = entry.summary?.trim();
  if (summary) return summary;
  return humanizeEventType(entry.eventType);
}

export function ActivityTrail() {
  const { data, isLoading, error, refetch } = useAudit();

  if (isLoading) return <ZoneSkeleton label="Loading activity" />;
  if (error) return <ZoneError message="Couldn't load activity." onRetry={() => refetch()} />;

  const entries: AuditEntryResponse[] = data?.entries ?? [];

  if (entries.length === 0) {
    return <ZoneEmpty message="No recent activity." />;
  }

  return (
    <section className="zone4" aria-label="Activity">
      <div className="zone-head">
        <span className="label">Activity</span>
      </div>

      <div className="activity" tabIndex={0}>
        {entries.map((entry) => (
          <div className="act-row" key={entry.id}>
            <span className="act-time">{formatHHMM(entry.timestamp)}</span>
            <span className="act-agent">{capitalize(agentForEntry(entry))}</span>
            <span className="act-msg">{rowLabel(entry)}</span>
            <Link className="act-arrow" href="/conversations">
              →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
