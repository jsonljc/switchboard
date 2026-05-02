"use client";

import { useDashboardOverview } from "@/hooks/use-dashboard-overview";
import { ZoneSkeleton, ZoneError } from "./zone-states";

export function NumbersStrip() {
  const { data, isLoading, error, refetch } = useDashboardOverview();

  if (isLoading) return <ZoneSkeleton label="Loading numbers" />;
  if (error) return <ZoneError message="Couldn't load numbers." onRetry={() => refetch()} />;

  const leadsToday = data?.stats.newInquiriesToday ?? 0;
  const leadsYesterday = data?.stats.newInquiriesYesterday ?? 0;
  const bookingsCount = data?.bookings.length ?? 0;

  return (
    <section className="numbers-strip" aria-label="Today's numbers">
      <div className="cell">
        <span className="label">Leads today</span>
        <span className="value">{leadsToday}</span>
        <span className="delta">vs {leadsYesterday} yesterday</span>
      </div>
      <div className="cell">
        <span className="label">Appointments</span>
        <span className="value">{bookingsCount}</span>
      </div>
      <div className="cell placeholder">
        <span className="label">Revenue today</span>
        <span className="value muted">—</span>
      </div>
      <div className="cell placeholder">
        <span className="label">Spend today</span>
        <span className="value muted">—</span>
      </div>
      <div className="cell placeholder">
        <span className="label">Reply time</span>
        <span className="value muted">—</span>
      </div>
    </section>
  );
}
