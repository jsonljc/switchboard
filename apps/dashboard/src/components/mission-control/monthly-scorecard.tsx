"use client";

import { useSpend } from "@/hooks/use-spend";
import { Skeleton } from "@/components/ui/skeleton";

/* ─── Max height for bar chart bars (px) ─── */
const BAR_MAX_PX = 52;

function shortDay(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3);
}

function buildNarrative(trend: Array<{ date: string; leads: number; bookings: number }>): string {
  if (!trend.length) return "";
  const totalLeads = trend.reduce((s, d) => s + d.leads, 0);
  const daysWithLeads = trend.filter((d) => d.leads > 0).length;
  if (totalLeads === 0) return "Your assistant is working on it.";
  if (daysWithLeads >= 6) return "Steady week — leads coming in consistently.";
  const best = trend.reduce((b, d) => (d.leads > b.leads ? d : b), trend[0]);
  const dayName = new Date(best.date).toLocaleDateString("en-US", { weekday: "long" });
  return `Your best day was ${dayName} with ${best.leads} lead${best.leads > 1 ? "s" : ""}.`;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function MonthlyScorecard() {
  const { data: summaryData, isLoading } = useSpend();

  if (isLoading) {
    return (
      <section className="border-t border-border/60 pt-10">
        <div className="flex gap-10">
          <Skeleton className="h-14 w-24" />
          <Skeleton className="h-14 w-20" />
          <Skeleton className="h-14 w-20" />
        </div>
      </section>
    );
  }

  const trend = summaryData?.spend.trend ?? [];
  const maxLeads = Math.max(...trend.map((d) => d.leads), 1);
  const maxBookings = Math.max(...trend.map((d) => d.bookings), 1);
  const narrative = buildNarrative(trend);

  const leads30 = summaryData?.outcomes.leads30d ?? 0;
  const bookings30 = summaryData?.outcomes.bookings30d ?? 0;
  const spend30 = summaryData?.spend.last30Days;
  const costPerLead = summaryData?.outcomes.costPerLead30d;

  return (
    <section className="border-t border-border/60 pt-10 space-y-8">
      <h2 className="section-label">This month</h2>

      {/* Key outcome numbers — outcomes before cost */}
      <div className="flex flex-wrap gap-8 sm:gap-14">
        <div>
          <p className="text-[32px] font-light text-foreground leading-none">{leads30}</p>
          <p className="text-[12px] text-muted-foreground mt-2">Leads</p>
        </div>

        {bookings30 > 0 && (
          <div>
            <p className="text-[32px] font-light text-foreground leading-none">{bookings30}</p>
            <p className="text-[12px] text-muted-foreground mt-2">Booked</p>
          </div>
        )}

        {costPerLead != null && (
          <div>
            <p className="text-[32px] font-light text-foreground leading-none">
              {fmt(costPerLead)}
            </p>
            <p className="text-[12px] text-muted-foreground mt-2">Per lead</p>
          </div>
        )}

        {spend30 != null && (
          <div>
            <p className="text-[32px] font-light text-foreground leading-none">{fmt(spend30)}</p>
            <p className="text-[12px] text-muted-foreground mt-2">Spent</p>
          </div>
        )}
      </div>

      {/* 7-day CSS bar chart — pure divs, no charting library */}
      {trend.length > 0 && (
        <div className="space-y-3">
          {narrative && <p className="text-[13px] text-muted-foreground italic">{narrative}</p>}

          {/* Bars */}
          <div className="flex items-end gap-1.5">
            {trend.map((day) => (
              <div key={day.date} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div className="flex items-end gap-0.5 w-full justify-center">
                  {/* Leads bar — positive green */}
                  <div
                    className="w-3 rounded-t-[2px] bg-positive/65 transition-all duration-slow"
                    style={{
                      height: Math.max(2, (day.leads / maxLeads) * BAR_MAX_PX) + "px",
                    }}
                  />
                  {/* Bookings bar — operator amber */}
                  <div
                    className="w-3 rounded-t-[2px] bg-operator/45 transition-all duration-slow"
                    style={{
                      height: Math.max(2, (day.bookings / maxBookings) * BAR_MAX_PX) + "px",
                    }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground/55 truncate">
                  {shortDay(day.date)}
                </span>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 pt-0.5">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-[2px] bg-positive/65" />
              <span className="text-[11px] text-muted-foreground">Leads</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-[2px] bg-operator/45" />
              <span className="text-[11px] text-muted-foreground">Bookings</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
