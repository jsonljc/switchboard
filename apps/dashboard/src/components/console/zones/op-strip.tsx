"use client";

import { useOrgConfig } from "@/hooks/use-org-config";
import { ZoneSkeleton, ZoneError } from "./zone-states";

function formatNow(date: Date): string {
  const day = date.toLocaleDateString("en-US", { weekday: "short" });
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${day} ${time}`;
}

export function OpStrip() {
  const { data, isLoading, error, refetch } = useOrgConfig();

  if (isLoading) return <ZoneSkeleton label="Loading op strip" />;
  if (error) return <ZoneError message="Couldn't load org config." onRetry={() => refetch()} />;

  const orgName = data?.config?.name ?? "Switchboard";
  const now = formatNow(new Date());

  return (
    <header className="opstrip">
      <div className="opstrip-row">
        <div className="op-left">
          <span className="brand">Switchboard</span>
          <span className="sep">·</span>
          <span className="org">{orgName}</span>
          <span className="sep">·</span>
          <span>{now}</span>
        </div>
        <div className="op-right">
          <span className="op-live">
            <span className="pulse" aria-hidden="true" />
            Live
          </span>
        </div>
      </div>
    </header>
  );
}
