"use client";

import { useMemo, useState } from "react";
import type { CampaignRow } from "../fixtures";
import { fmtMoney } from "./format";
import styles from "../reports.module.css";

type SortKey = "name" | "spend" | "leads" | "revenue" | "roas";
type SortDir = "asc" | "desc";

interface ColDef {
  key: SortKey;
  label: string;
  numeric: boolean;
}

const COLS: ColDef[] = [
  { key: "name", label: "Campaign", numeric: false },
  { key: "spend", label: "Spend", numeric: true },
  { key: "leads", label: "Leads", numeric: true },
  { key: "revenue", label: "Revenue", numeric: true },
  { key: "roas", label: "ROAS", numeric: true },
];

function stageClass(stage: CampaignRow["stage"]): string {
  if (stage === "hot") return styles.isHot;
  if (stage === "warm") return styles.isWarm;
  return styles.isCool;
}

interface CampaignsProps {
  data: CampaignRow[];
  period: string;
}

export function Campaigns({ data, period }: CampaignsProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "revenue",
    dir: "desc",
  });

  function clickHeader(key: SortKey) {
    setSort((s) => {
      if (s.key === key) return { key, dir: s.dir === "asc" ? "desc" : "asc" };
      const col = COLS.find((c) => c.key === key);
      return { key, dir: col?.numeric ? "desc" : "asc" };
    });
  }

  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") {
        return sort.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = av as number;
      const bn = bv as number;
      return sort.dir === "asc" ? an - bn : bn - an;
    });
    return arr;
  }, [data, sort]);

  const totals = useMemo(() => {
    const sum = { spend: 0, leads: 0, revenue: 0 };
    for (const r of data) {
      sum.spend += r.spend;
      sum.leads += r.leads;
      sum.revenue += r.revenue;
    }
    return { ...sum, roas: sum.spend ? sum.revenue / sum.spend : 0 };
  }, [data]);

  return (
    <>
      <div className={styles.folio}>
        <span className={styles.folioL}>Where the money came from</span>
        <span className={styles.folioR}>{period}</span>
      </div>

      {/* Desktop / tablet table */}
      <div className={styles.campaignsWrap}>
        <table className={styles.campaigns}>
          <thead>
            <tr>
              {COLS.map((c) => {
                const headerCls = [
                  c.numeric ? styles.isNumeric : "",
                  sort.key === c.key ? styles.isActive : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const glyphCls = sort.dir === "asc" ? styles.isAsc : "";
                return (
                  <th
                    key={c.key}
                    className={headerCls}
                    onClick={() => clickHeader(c.key)}
                    scope="col"
                  >
                    {c.label}
                    <span className={`${styles.sortGlyph} ${glyphCls}`}>↓</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.name}>
                <td>
                  <span
                    className={`${styles.stageSquare} ${stageClass(r.stage)}`}
                    aria-hidden="true"
                  />
                  {r.name}
                </td>
                <td className={styles.isNumeric}>{fmtMoney(r.spend)}</td>
                <td className={styles.isNumeric}>{r.leads.toLocaleString()}</td>
                <td className={styles.isNumeric}>{fmtMoney(r.revenue)}</td>
                <td className={styles.isNumeric}>{r.roas.toFixed(1)}×</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={styles.label}>Total</td>
              <td className={styles.isNumeric}>{fmtMoney(totals.spend)}</td>
              <td className={styles.isNumeric}>{totals.leads.toLocaleString()}</td>
              <td className={styles.isNumeric}>{fmtMoney(totals.revenue)}</td>
              <td className={styles.isNumeric}>{totals.roas.toFixed(1)}×</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mobile cards */}
      <div className={styles.campaignsCards}>
        {sorted.map((r) => (
          <div key={r.name} className={styles.campaignCard}>
            <div className={styles.ccName}>
              <span className={`${styles.stageSquare} ${stageClass(r.stage)}`} aria-hidden="true" />
              {r.name}
            </div>
            <div className={styles.ccGrid}>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>Spend</span>
                <span className={styles.val}>{fmtMoney(r.spend)}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>Leads</span>
                <span className={styles.val}>{r.leads}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>Revenue</span>
                <span className={styles.val}>{fmtMoney(r.revenue)}</span>
              </div>
              <div className={styles.ccRow}>
                <span className={styles.lbl}>ROAS</span>
                <span className={styles.val}>{r.roas.toFixed(1)}×</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
