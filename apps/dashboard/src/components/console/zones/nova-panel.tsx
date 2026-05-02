"use client";

import Link from "next/link";
import { useModuleStatus } from "@/hooks/use-module-status";
import { ZoneSkeleton, ZoneError, ZoneEmpty } from "./zone-states";

export function NovaPanel() {
  const modules = useModuleStatus();

  if (modules.isLoading) return <ZoneSkeleton label="Loading ad actions" />;
  if (modules.error) {
    return <ZoneError message="Couldn't load ad actions." onRetry={() => modules.refetch()} />;
  }

  const list = (modules.data ?? []) as Array<{ id: string; state: string }>;
  const adOptimizerLive = list.some((m) => m.id === "ad-optimizer" && m.state === "live");

  if (!adOptimizerLive) {
    return (
      <ZoneEmpty
        message="No ad-optimizer deployed yet."
        cta={
          <Link href="/marketplace" className="btn btn-text">
            Connect ad-optimizer →
          </Link>
        }
      />
    );
  }

  // Live panel rendering: headline + ad-set rows.
  // Real row data is Option-C territory (see spec §3 out-of-scope).
  // For PR-2, render the headline + a placeholder line — honest about the data
  // state, not the Aurora Dental fixture.
  return (
    <section className="nova-panel" aria-label="Nova ad actions">
      <header>
        <h2>Nova · Ad actions</h2>
      </header>
      <p className="muted">Ad-set rows render here once the aggregation is wired (Option C).</p>
    </section>
  );
}
