import { cn } from "@/lib/utils";

export type AttributionTracking =
  | "verified"
  | "no_recent_traffic"
  | "v2_pending"
  | "missing_webhook";

export type AttributionSourceKey = "ctwa" | "instant_form" | "web";

export interface AttributionSourceCoverage {
  campaigns: number;
  spend: number;
  tracking: AttributionTracking;
}

export interface AttributionCoverageProps {
  coveragePct: number;
  bySource: Record<AttributionSourceKey, AttributionSourceCoverage>;
}

const SOURCE_LABELS: Record<AttributionSourceKey, string> = {
  ctwa: "CTWA",
  instant_form: "Instant Form",
  web: "Web",
};

const TRACKING_COPY: Record<AttributionTracking, string> = {
  verified: "Verified",
  no_recent_traffic: "No recent test traffic",
  v2_pending: "Coming in v2",
  missing_webhook: "Webhook missing",
};

const TRACKING_PILL: Record<AttributionTracking, string> = {
  verified: "bg-emerald-100 text-emerald-800 border-emerald-200",
  no_recent_traffic: "bg-amber-100 text-amber-800 border-amber-200",
  v2_pending: "bg-muted text-muted-foreground border-border",
  missing_webhook: "bg-red-100 text-red-800 border-red-200",
};

const SOURCE_ORDER: AttributionSourceKey[] = ["ctwa", "instant_form", "web"];

const formatSpend = (spend: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(spend);

export function AttributionCoverage({ coveragePct, bySource }: AttributionCoverageProps) {
  const pct = Math.round(coveragePct * 100);

  return (
    <section className="rounded-2xl border border-border bg-card p-6 md:p-8">
      <div className="space-y-1">
        <p className="section-label">Attribution coverage</p>
        <div className="flex items-baseline gap-3">
          <span className="font-display text-5xl md:text-6xl text-foreground">{pct}%</span>
        </div>
        <p className="text-sm text-muted-foreground max-w-md">
          of your ad spend can be attributed to outcomes
        </p>
      </div>

      <ul className="mt-6 divide-y divide-border border-t border-border">
        {SOURCE_ORDER.map((key) => {
          const source = bySource[key];
          return (
            <li key={key} className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="font-medium text-foreground">{SOURCE_LABELS[key]}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {source.campaigns} {source.campaigns === 1 ? "campaign" : "campaigns"}
                  {" · "}
                  {formatSpend(source.spend)}
                </p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                  TRACKING_PILL[source.tracking],
                )}
              >
                {TRACKING_COPY[source.tracking]}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
