"use client";

import type { ManagedComparisonData, ManagedComparisonPair } from "@switchboard/schemas";
import styles from "../../../reports/reports.module.css";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function PairRow({ label, pair }: { label: string; pair: ManagedComparisonPair }) {
  return (
    <div>
      <div className={styles.folio}>
        <span className={styles.folioL}>{label}</span>
      </div>
      <table className={styles.campaigns} style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th scope="col">Cohort</th>
            <th className={styles.isNumeric} scope="col">
              Spend
            </th>
            {pair.managed.replies !== undefined && (
              <th className={styles.isNumeric} scope="col">
                Threads
              </th>
            )}
            {pair.managed.revenue !== undefined && (
              <th className={styles.isNumeric} scope="col">
                Revenue
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Switchboard-managed</td>
            <td className={styles.isNumeric}>{fmtMoney(pair.managed.spend)}</td>
            {pair.managed.replies !== undefined && (
              <td className={styles.isNumeric}>{pair.managed.replies}</td>
            )}
            {pair.managed.revenue !== undefined && (
              <td className={styles.isNumeric}>{fmtMoney(pair.managed.revenue)}</td>
            )}
          </tr>
          <tr>
            <td>Baseline / Unmanaged</td>
            <td className={styles.isNumeric}>{fmtMoney(pair.unmanaged.spend)}</td>
            {pair.unmanaged.replies !== undefined && (
              <td className={styles.isNumeric}>{pair.unmanaged.replies}</td>
            )}
            {pair.unmanaged.revenue !== undefined && (
              <td className={styles.isNumeric}>{fmtMoney(pair.unmanaged.revenue)}</td>
            )}
          </tr>
        </tbody>
      </table>
      <div style={{ marginTop: 4, fontSize: "0.85em", opacity: 0.7 }}>{pair.delta.text}</div>
    </div>
  );
}

interface ManagedComparisonProps {
  data: ManagedComparisonData;
  period: string;
}

export function ManagedComparison({ data, period }: ManagedComparisonProps) {
  const sourceLabel =
    data.source === "pre-switchboard-baseline"
      ? "vs pre-Switchboard baseline (not a controlled holdout)"
      : "vs in-period unmanaged";

  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>Switchboard Impact</span>
        <span className={styles.folioR}>{period}</span>
      </div>
      <div style={{ fontSize: "0.85em", opacity: 0.7, marginBottom: 12 }}>{sourceLabel}</div>
      {data.ads ? (
        <PairRow label="Ads (Riley-managed)" pair={data.ads} />
      ) : (
        <div style={{ opacity: 0.5, padding: "8px 0" }}>Not enough ad data yet</div>
      )}
      {data.conversations ? (
        <PairRow label="Conversations (Alex-managed)" pair={data.conversations} />
      ) : (
        <div style={{ opacity: 0.5, padding: "8px 0" }}>
          Not enough Alex-managed conversation data yet
        </div>
      )}
      {data.emptyMessage && (
        <div style={{ opacity: 0.5, padding: "8px 0" }}>{data.emptyMessage}</div>
      )}
    </>
  );
}
