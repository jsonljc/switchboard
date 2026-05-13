import type {
  ManagedComparisonData,
  ManagedComparisonMetrics,
  ManagedComparisonPair,
  ManagedComparisonSource,
} from "@switchboard/schemas";
import styles from "../reports.module.css";
import { fmtSGD, fmtInt, fmtPct } from "./format";

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
    render: (v) => (v == null ? "—" : `${v.toFixed(2)}×`),
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
      <div className={styles.colEyebrow}>{title}</div>
      {visible.map((m) => (
        <div className={styles.mcMetric} key={m.key}>
          <span className={styles.label}>{m.label}</span>
          <div className={`${styles.mcSide} ${styles.managed}`}>
            <span className={styles.who}>Managed</span>
            <span className={styles.v}>{m.render(pair.managed[m.key])}</span>
            {m.key === lastKey && pair.delta && (
              <span className={styles.delta}>{pair.delta.text}</span>
            )}
          </div>
          <div className={`${styles.mcSide} ${styles.unmanaged}`}>
            <span className={styles.who}>Unmanaged</span>
            <span className={styles.v}>{m.render(pair.unmanaged[m.key])}</span>
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
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.eyebrow}>How you&apos;re doing with us vs. without</span>
          <span className={styles.right}>{sourceCaption(data.source)}</span>
        </div>
        <div className={styles.mcWrap}>
          <p className={styles.emptyMessage}>{data.emptyMessage}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>How you&apos;re doing with us vs. without</span>
        <span className={styles.right}>{sourceCaption(data.source)}</span>
      </div>

      <div className={styles.mcWrap}>
        <div
          className={styles.mcGrid}
          style={data.ads && data.conversations ? undefined : { gridTemplateColumns: "1fr" }}
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
