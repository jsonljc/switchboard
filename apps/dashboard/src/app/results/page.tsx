"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpend } from "@/hooks/use-spend";
import { cn } from "@/lib/utils";

/* ─── Constants ─── */
const BENCHMARK_COST_PER_LEAD = 15; // $15 — make skin-aware later
const BAR_MAX_PX = 60;

/* ─── Helpers ─── */
function shortDay(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3);
}

function formatCurrency(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function buildNarrative(trend: Array<{ date: string; leads: number; bookings: number }>): string {
  if (trend.length === 0) return "No data yet for this period.";
  const totalLeads = trend.reduce((sum, d) => sum + d.leads, 0);
  if (totalLeads === 0) return "Your assistant is warming up — no leads tracked yet.";
  const best = trend.reduce((a, b) => (a.leads > b.leads ? a : b));
  const bestDay = shortDay(best.date);
  if (best.leads > 1) return `Your best day this week was ${bestDay} with ${best.leads} leads.`;
  return "Steady activity this week — keep the budget running.";
}

/* ─── Scorecard tile ─── */
function ScorecardTile({
  label,
  value,
  badge,
  badgeVariant,
  sub,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeVariant?: "positive" | "caution" | "muted";
  sub?: string;
}) {
  const badgeClass =
    badgeVariant === "positive"
      ? "text-positive-foreground bg-positive/15"
      : badgeVariant === "caution"
        ? "text-caution-foreground bg-caution/15"
        : "text-muted-foreground bg-muted";

  return (
    <div className="space-y-1">
      <p className="section-label">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-[32px] font-light text-foreground leading-none">{value}</p>
        {badge && (
          <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", badgeClass)}>
            {badge}
          </span>
        )}
      </div>
      {sub && <p className="text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ─── Week story chart (CSS-only, no library) ─── */
function WeekStoryChart({
  trend,
}: {
  trend: Array<{ date: string; spend: number | null; leads: number; bookings: number }>;
}) {
  const maxLeads = Math.max(...trend.map((d) => d.leads), 1);
  const narrative = buildNarrative(trend);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold text-foreground">This week</h2>
        <p className="text-[13px] text-muted-foreground mt-0.5">{narrative}</p>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-2">
        {trend.map((day) => {
          const leadsH = Math.max(2, (day.leads / maxLeads) * BAR_MAX_PX);
          const bookingsH = Math.max(2, (day.bookings / maxLeads) * BAR_MAX_PX);
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="flex items-end gap-[2px] w-full justify-center"
                style={{ height: BAR_MAX_PX + "px" }}
              >
                <div
                  className="w-[45%] rounded-t-sm bg-positive/65 transition-all"
                  style={{ height: leadsH + "px" }}
                  title={`${day.leads} leads`}
                />
                <div
                  className="w-[45%] rounded-t-sm bg-operator/45 transition-all"
                  style={{ height: bookingsH + "px" }}
                  title={`${day.bookings} booked`}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">{shortDay(day.date)}</p>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-positive/65" />
          <span className="text-[11.5px] text-muted-foreground">Leads</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm bg-operator/45" />
          <span className="text-[11.5px] text-muted-foreground">Booked</span>
        </div>
      </div>
    </section>
  );
}

/* ─── Main page ─── */
export default function ResultsPage() {
  const { status } = useSession();
  const { data, isLoading } = useSpend();

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-10">
        <div className="space-y-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-40" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  const outcomes = data?.outcomes;
  const spend = data?.spend;
  const trend = spend?.trend ?? [];

  const leads30 = outcomes?.leads30d ?? 0;
  const bookings30 = outcomes?.bookings30d ?? 0;
  const costPerLead = outcomes?.costPerLead30d ?? null;
  const spend30 = spend?.last30Days ?? 0;

  // Quality badge for costPerLead
  const cpLBadge =
    costPerLead === null
      ? undefined
      : costPerLead < BENCHMARK_COST_PER_LEAD
        ? { label: "Good rate", variant: "positive" as const }
        : { label: "Check this", variant: "caution" as const };

  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Results</h1>
        <p className="text-[14px] text-muted-foreground">
          What your money has produced in the last 30 days.
        </p>
      </section>

      {/* Scorecard — outcomes first, cost second */}
      <section>
        <p className="section-label mb-4">This month</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6">
          <ScorecardTile label="Leads" value={leads30.toString()} sub="people reached" />
          <ScorecardTile label="Booked" value={bookings30.toString()} sub="appointments set" />
          <ScorecardTile
            label="Per lead"
            value={costPerLead !== null ? `$${costPerLead.toFixed(2)}` : "—"}
            badge={cpLBadge?.label}
            badgeVariant={cpLBadge?.variant}
            sub="cost to get attention"
          />
          <ScorecardTile
            label="Spent"
            value={spend30 ? formatCurrency(spend30) : "—"}
            sub="ad budget used"
          />
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Week story chart */}
      {trend.length > 0 && <WeekStoryChart trend={trend} />}

      {/* Divider */}
      <div className="border-t border-border/40" />

      {/* Cost interpretation — plain English */}
      <section className="space-y-5">
        <h2 className="text-[17px] font-semibold text-foreground">What the numbers mean</h2>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-surface p-5">
            <p className="text-[13.5px] text-foreground font-medium mb-1">Per lead</p>
            <p className="text-[14px] text-muted-foreground leading-relaxed">
              {costPerLead !== null
                ? `$${costPerLead.toFixed(2)} — that's what it cost to get one person's contact info. Under $${BENCHMARK_COST_PER_LEAD} is strong for most service businesses.`
                : "Not enough data yet — cost per lead will appear once your campaigns have run."}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface p-5">
            <p className="text-[13.5px] text-foreground font-medium mb-1">Booked rate</p>
            <p className="text-[14px] text-muted-foreground leading-relaxed">
              {leads30 > 0
                ? `${bookings30} out of ${leads30} leads booked an appointment — that's ${Math.round((bookings30 / leads30) * 100)}%. Your assistant is qualifying and following up automatically.`
                : "No booking data yet. Your assistant will track this as leads come in."}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-surface p-5">
            <p className="text-[13.5px] text-foreground font-medium mb-1">Total spend</p>
            <p className="text-[14px] text-muted-foreground leading-relaxed">
              {spend30
                ? `${formatCurrency(spend30)} over the last 30 days — your assistant monitors this and can adjust budgets within limits you've set in Decisions.`
                : "Spend data will appear once your ad account is connected."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
