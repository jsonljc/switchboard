"use client";
import Link from "next/link";
import type { HomeSummaryCentsMetric, HomeSummaryCountMetric } from "@switchboard/schemas";
import { useHomeSummary } from "@/hooks/use-home-summary";
import { useDecisionFeed } from "@/hooks/use-decision-feed";
import { Money } from "@/lib/money";
import { DeltaBadge } from "@/components/results/delta-badge";
import type { Delta } from "@/components/results/types";
import { StatePanel, Skeleton } from "@/components/query-states";
import styles from "./home-kpi-strip.module.css";

/**
 * Convert (current, prev?) to a Delta for DeltaBadge.
 * Delta.kind is "pos" | "neg" | "flat" -- NOT "up"/"down".
 */
function toDelta(current: number, prev?: number): Delta | null {
  if (prev === undefined) return null;
  const diff = current - prev;
  if (diff === 0) return { kind: "flat", text: "0" };
  return {
    kind: diff > 0 ? "pos" : "neg",
    text: `${diff > 0 ? "+" : ""}${diff}`,
  };
}

export function HomeKpiStrip(): JSX.Element {
  const summary = useHomeSummary();
  const decisions = useDecisionFeed(null);

  if (summary.isLoading) return <Skeleton className={styles.stripSkeleton} />;
  if (summary.isError || !summary.data)
    return (
      <StatePanel
        role="alert"
        eyebrow="Couldn't load"
        title="We couldn't reach this week's numbers."
        body="This is usually momentary. Try again in a moment."
      />
    );

  const { attributedValueCents, bookings } = summary.data;
  const approval = decisions.data?.counts.approval ?? null;

  return (
    <section className={styles.strip} aria-label="This week">
      <ValueTile metric={attributedValueCents} />
      <CountTile metric={bookings} label="Bookings" />
      <ApprovalTile count={approval} />
    </section>
  );
}

function ValueTile({ metric }: { metric: HomeSummaryCentsMetric }) {
  return (
    <div className={styles.tile} data-kind="value">
      <span className={styles.eyebrow}>Attributed booking value</span>
      {metric.state === "ready" ? (
        <>
          <span className={styles.figure}>
            <Money value={metric.value / 100} />
          </span>
          <DeltaBadge
            delta={toDelta(metric.value / 100, metric.comparator && metric.comparator.value / 100)}
          />
          <span className={styles.sub}>Booked this week, not yet collected</span>
        </>
      ) : metric.state === "empty" ? (
        <span className={styles.empty}>
          No attributed bookings yet this week. When an agent creates one, its booked value will
          appear here.
        </span>
      ) : (
        <span className={styles.empty}>Not available right now.</span>
      )}
    </div>
  );
}

function CountTile({ metric, label }: { metric: HomeSummaryCountMetric; label: string }) {
  return (
    <div className={styles.tile} data-kind="count">
      <span className={styles.eyebrow}>{label}</span>
      {metric.state === "ready" ? (
        <>
          <span className={styles.figure}>{metric.value}</span>
          <DeltaBadge delta={toDelta(metric.value, metric.comparator?.value)} />
        </>
      ) : metric.state === "unavailable" ? (
        <span className={styles.empty}>Not available right now.</span>
      ) : (
        <span className={styles.empty}>None yet this week.</span>
      )}
    </div>
  );
}

function ApprovalTile({ count }: { count: number | null }) {
  return (
    <Link href="/operator" className={styles.actionTile} data-kind="approval">
      <span className={styles.eyebrow}>Awaiting your approval</span>
      <span className={styles.figure}>{count ?? "—"}</span>
      <span className={styles.cta}>Review queue</span>
    </Link>
  );
}
