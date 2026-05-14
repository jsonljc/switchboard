"use client";

import styles from "../../approvals.module.css";
import detailStyles from "../../detail.module.css";
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
      ? detailStyles.dhTimer_warn
      : level === "critical"
        ? detailStyles.dhTimer_critical
        : level === "expired"
          ? detailStyles.dhTimer_expired
          : "";

  return (
    <div className={detailStyles.dblock}>
      <div className={detailStyles.detailHead}>
        <div className={detailStyles.dhRow}>
          <span className={detailStyles.dhPill} data-risk={row.riskCategory}>
            {row.riskCategory}
          </span>
          <span className={`${detailStyles.dhTimer} ${levelClass}`}>
            <span className={styles.eyebrow}>{remaining <= 0 ? "expired" : "expires in"}</span>
            <span>{formatRemaining(remaining)}</span>
          </span>
        </div>
        <h2 className={detailStyles.dhSummary}>{row.summary}</h2>
        <div className={detailStyles.dhFoot}>
          <span>
            <b>{agent.name}</b>
            {agent.role ? ` · ${agent.role}` : ""}
          </span>
          <span className={detailStyles.dhFootSep}>·</span>
          <span>
            action: <b>{action}</b>
          </span>
        </div>
        <div className={detailStyles.params}>
          <div className={detailStyles.paramsHead}>
            <span className={styles.eyebrow}>details</span>
          </div>
          <dl className={detailStyles.paramsList}>
            {Object.entries(params).map(([k, v]) => (
              <div key={k} className={detailStyles.paramsRow}>
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
