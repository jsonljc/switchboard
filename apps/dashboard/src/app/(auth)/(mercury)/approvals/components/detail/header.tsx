"use client";

import styles from "../../approvals.module.css";
import { formatRemaining, timerLevel } from "../../format";
import { agentDisplay } from "../../hooks/use-agent-display";
import { actionDisplay } from "../../action-display";
import type { DetailRow } from "../../types";

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return v.toLocaleString();
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface DetailHeaderProps {
  row: DetailRow;
  now: number;
}

export function DetailHeader({ row, now }: DetailHeaderProps) {
  const remaining = new Date(row.expiresAt).getTime() - now;
  const level = timerLevel(remaining);
  const agent = agentDisplay(row.agent);
  const action = actionDisplay(row.request?.action);
  const params = row.request?.parametersSnapshot ?? {};

  const levelClass =
    level === "warn"
      ? styles.dhTimer_warn
      : level === "critical"
        ? styles.dhTimer_critical
        : level === "expired"
          ? styles.dhTimer_expired
          : "";

  return (
    <div className={styles.dblock}>
      <div className={styles.detailHead}>
        <div className={styles.dhRow}>
          <span className={styles.dhPill} data-risk={row.riskCategory}>
            {row.riskCategory}
          </span>
          <span className={`${styles.dhTimer} ${levelClass}`}>
            <span className={styles.eyebrow}>{remaining <= 0 ? "expired" : "expires in"}</span>
            <span>{formatRemaining(remaining)}</span>
          </span>
        </div>
        <h2 className={styles.dhSummary}>{row.summary}</h2>
        <div className={styles.dhFoot}>
          <span>
            <b>{agent.name}</b>
            {agent.role ? ` · ${agent.role}` : ""}
          </span>
          <span className={styles.dhFootSep}>·</span>
          <span>
            action: <b>{action}</b>
          </span>
        </div>
        <div className={styles.params}>
          <div className={styles.paramsHead}>
            <span className={styles.eyebrow}>details</span>
          </div>
          <dl className={styles.paramsList}>
            {Object.entries(params).map(([k, v]) => (
              <div key={k} className={styles.paramsRow}>
                <dt>{k}</dt>
                <dd>{renderValue(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
