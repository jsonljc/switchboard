import type {
  ManagedComparisonData,
  ManagedComparisonMetrics,
  ManagedComparisonPair,
  ManagedComparisonSource,
} from "./types";
import styles from "./results.module.css";
import { fmtSGD, fmtInt, fmtPct } from "@/app/(auth)/(mercury)/reports/components/format";
import { fmtRatio } from "./results-model";

function sourceCaption(s: ManagedComparisonSource): string {
  return s === "in-period-cohort"
    ? "Compared to similar accounts this period"
    : "Compared to your pre-Switchboard baseline";
}

type MetricKey = keyof ManagedComparisonMetrics;
type Render = (v: number | undefined) => string;

const ADS_METRICS: { key: MetricKey; label: string; render: Render }[] = [
  {
    key: "spend",
    label: "Spend",
    render: (v) => (v == null ? "—" : fmtSGD(v, { withCents: "never" })),
  },
  {
    key: "revenue",
    label: "Revenue",
    render: (v) => (v == null ? "—" : fmtSGD(v, { withCents: "never" })),
  },
  {
    key: "roas",
    label: "ROAS",
    render: (v) => (v == null ? "—" : fmtRatio(v)),
  },
];

const CONV_METRICS: { key: MetricKey; label: string; render: Render }[] = [
  {
    key: "replies",
    label: "Replies handled",
    render: (v) => (v == null ? "—" : fmtInt(v)),
  },
  {
    key: "conversionRate",
    label: "Conversion rate",
    render: (v) => (v == null ? "—" : fmtPct(v, 1)),
  },
  {
    key: "replyMinutesP50",
    label: "Median reply time",
    render: (v) => (v == null ? "—" : `${v} min`),
  },
];

function MCColumn({
  title,
  metrics,
  pair,
}: {
  title: string;
  metrics: { key: MetricKey; label: string; render: Render }[];
  pair: ManagedComparisonPair;
}) {
  const visible = metrics.filter(
    (m) => pair.managed[m.key] != null || pair.unmanaged[m.key] != null,
  );
  const lastKey = visible[visible.length - 1]?.key;

  return (
    <div className={styles.mcCol}>
      <div className={styles.mcColEyebrow}>{title}</div>
      {visible.map((m) => (
        <div className={styles.mcMetric} key={m.key}>
          <span className={styles.mcLabel}>{m.label}</span>
          <div className={styles.mcSide}>
            <span className={styles.mcWho}>Managed</span>
            <span className={styles.mcVal}>{m.render(pair.managed[m.key])}</span>
            {m.key === lastKey && pair.delta && (
              <span className={styles.mcDelta}>{pair.delta.text}</span>
            )}
          </div>
          <div className={styles.mcSide}>
            <span className={styles.mcWho}>Unmanaged</span>
            <span className={styles.mcVal}>{m.render(pair.unmanaged[m.key])}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ManagedComparison({ data }: { data: ManagedComparisonData }) {
  if (!data.ads && !data.conversations) {
    if (!data.emptyMessage) return null;
    return (
      <section className={styles.mcSection}>
        <div className={styles.mcHead}>
          <span className={styles.mcEyebrow}>How you&apos;re doing with us vs. without</span>
          <span className={styles.mcCaption}>{sourceCaption(data.source)}</span>
        </div>
        <div className={styles.mcWrap}>
          <p className={styles.mcEmpty}>{data.emptyMessage}</p>
        </div>
      </section>
    );
  }

  const singleCol = !data.ads || !data.conversations;

  return (
    <section className={styles.mcSection}>
      <div className={styles.mcHead}>
        <span className={styles.mcEyebrow}>How you&apos;re doing with us vs. without</span>
        <span className={styles.mcCaption}>{sourceCaption(data.source)}</span>
      </div>

      <div className={styles.mcWrap}>
        <div
          className={styles.mcGrid}
          style={singleCol ? { gridTemplateColumns: "1fr" } : undefined}
        >
          {data.ads && <MCColumn title="Ads" metrics={ADS_METRICS} pair={data.ads} />}
          {data.conversations && (
            <MCColumn title="Conversations" metrics={CONV_METRICS} pair={data.conversations} />
          )}
        </div>
      </div>
    </section>
  );
}
