import { formatSGDCompact, pluralize } from "./format";
import { SavingIndicator } from "./saving-indicator";
import type { FilterState, UpdatedRange } from "./filter-strip";
import styles from "../pipeline.module.css";

const RANGE_DESCRIPTION: Record<UpdatedRange, string> = {
  all: "all time",
  "24h": "last 24h",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

export function PipelineHeader({
  openCents,
  openCount,
  wonCents,
  wonCount,
  filters,
  saving,
}: {
  openCents: number;
  openCount: number;
  wonCents: number;
  wonCount: number;
  filters: FilterState;
  saving: boolean;
}) {
  const filterActive = filters.range !== "all" || filters.qualifiedOnly;
  const filterSuffix = filterActive ? " (filtered)" : "";
  const wonPeriod = filters.range === "all" ? "all time" : RANGE_DESCRIPTION[filters.range];

  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderLeft}>
        <span className={styles.eyebrow}>Mercury Tools · Pipeline</span>
        <h1 className={styles.pageTitle}>Opportunity pipeline</h1>
        <p className={styles.pageLede}>
          Every active deal across all eight stages. Drag a card to move it &mdash; the change saves
          quietly. Won and lost columns are dimmed; nurturing parks the long tail.
        </p>
      </div>
      <div className={styles.pageHeaderRight}>
        <StatTile
          label="open pipeline"
          value={formatSGDCompact(openCents) ?? "—"}
          sublabel={`${openCount} ${pluralize(openCount, "opportunity", "opportunities")}${filterSuffix}`}
        />
        <StatTile
          label="won this period"
          value={formatSGDCompact(wonCents) ?? "—"}
          sublabel={`${wonCount} captured · ${wonPeriod}${filterSuffix}`}
          tone="accent"
        />
        <SavingIndicator saving={saving} />
      </div>
    </header>
  );
}

function StatTile({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  tone?: "accent";
}) {
  return (
    <div className={styles.statTile}>
      <span className={styles.eyebrow}>{label}</span>
      <div className={styles.statValue} data-tone={tone} data-tabular>
        {value}
      </div>
      <div className={styles.statSub} data-tabular>
        {sublabel}
      </div>
    </div>
  );
}

/** Legacy export kept until contacts-page.tsx is deleted in Task 18. */
export function ContactsHeader() {
  return null;
}
