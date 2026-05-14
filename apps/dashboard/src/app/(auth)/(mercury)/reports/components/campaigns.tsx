"use client";
import { useMemo, useState } from "react";
import type { CampaignRow } from "@switchboard/schemas";
import styles from "../reports.module.css";
import { fmtSGD, fmtPct, fmtInt } from "./format";

type SortDir = "asc" | "desc";

interface Column {
  id: keyof CampaignRow;
  label: string;
  sub: string | null;
  num: boolean;
}

const COLS: Column[] = [
  { id: "name", label: "Campaign", sub: null, num: false },
  { id: "spend", label: "Spend", sub: "SGD", num: true },
  { id: "impressions", label: "Impr.", sub: null, num: true },
  { id: "inlineLinkClicks", label: "Clicks", sub: "CTR", num: true },
  { id: "costPerInlineLinkClick", label: "CPC", sub: null, num: true },
  { id: "leads", label: "Leads", sub: "Click→Lead", num: true },
  { id: "cpl", label: "CPL", sub: null, num: true },
  { id: "revenue", label: "Revenue", sub: "SGD", num: true },
  { id: "roas", label: "ROAS", sub: "rev/spend", num: true },
];

export function Campaigns({ campaigns }: { campaigns: CampaignRow[] }) {
  const [sortCol, setSortCol] = useState<keyof CampaignRow>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const roasMax = Math.max(...campaigns.map((c) => c.roas ?? 0), 1);

  const sorted = useMemo(() => {
    const arr = [...campaigns];
    arr.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [campaigns, sortCol, sortDir]);

  function clickHeader(col: Column) {
    if (sortCol === col.id) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col.id);
      setSortDir(col.num ? "desc" : "asc");
    }
  }

  const tot = campaigns.reduce(
    (a, c) => ({
      spend: a.spend + (c.spend || 0),
      impressions: a.impressions + (c.impressions || 0),
      inlineLinkClicks: a.inlineLinkClicks + (c.inlineLinkClicks || 0),
      leads: a.leads + (c.leads || 0),
      revenue: a.revenue + (c.revenue || 0),
    }),
    { spend: 0, impressions: 0, inlineLinkClicks: 0, leads: 0, revenue: 0 },
  );
  const totRoas = tot.spend > 0 ? tot.revenue / tot.spend : 0;
  const totCpc = tot.inlineLinkClicks > 0 ? tot.spend / tot.inlineLinkClicks : null;
  const totCpl = tot.leads > 0 ? tot.spend / tot.leads : null;
  const totCtr = tot.impressions > 0 ? tot.inlineLinkClicks / tot.impressions : 0;
  const totC2L = tot.inlineLinkClicks > 0 ? tot.leads / tot.inlineLinkClicks : 0;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.eyebrow}>Campaigns</span>
        <span className={styles.right}>{campaigns.length} · sort by revenue (default)</span>
      </div>

      <div className={styles.tblWrap}>
        <div className={styles.tblScroll}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                {COLS.map((c) => {
                  const isActive = sortCol === c.id;
                  return (
                    <th
                      key={c.id}
                      className={[
                        c.id === "name" ? styles.name : "",
                        styles.sortable,
                        isActive ? `${styles.active} ${styles[sortDir]}` : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => clickHeader(c)}
                    >
                      {c.label}
                      <span className={styles.arrow}>↓</span>
                      {c.sub && <span className={styles.sub}>{c.sub}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const roasDepth = c.roas != null ? Math.min(1, c.roas / roasMax) : 0;
                const isDead = c.inlineLinkClicks === 0 || (c.roas === 0 && c.leads === 0);
                return (
                  <tr key={c.name}>
                    <td className={styles.name}>{c.name}</td>
                    <td>{fmtSGD(c.spend, { withCents: "never" })}</td>
                    <td>{fmtInt(c.impressions)}</td>
                    <td>
                      {fmtInt(c.inlineLinkClicks)}
                      <span className={styles.submetric}>
                        {fmtPct(c.inlineLinkClickCtr, 2)} CTR
                      </span>
                    </td>
                    <td className={c.costPerInlineLinkClick === 0 ? styles.muted : ""}>
                      {c.costPerInlineLinkClick === 0
                        ? "—"
                        : fmtSGD(c.costPerInlineLinkClick, { withCents: "always" })}
                    </td>
                    <td>
                      {fmtInt(c.leads)}
                      <span className={styles.submetric}>{fmtPct(c.clickToLeadRate, 1)}</span>
                    </td>
                    <td className={c.cpl == null ? styles.muted : ""}>
                      {c.cpl == null ? "—" : fmtSGD(c.cpl)}
                    </td>
                    <td>{c.revenue > 0 ? fmtSGD(c.revenue, { withCents: "never" }) : "—"}</td>
                    <td>
                      <span className={`${styles.roasCell} ${isDead ? styles.dead : ""}`}>
                        <span
                          className={styles.v}
                          style={{ "--roas-depth": roasDepth.toFixed(2) } as React.CSSProperties}
                        >
                          {(c.roas ?? 0).toFixed(2)}×
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.name}>TOTAL · {campaigns.length} campaigns</td>
                <td>{fmtSGD(tot.spend, { withCents: "never" })}</td>
                <td>{fmtInt(tot.impressions)}</td>
                <td>
                  {fmtInt(tot.inlineLinkClicks)}
                  <span className={styles.submetric}>{fmtPct(totCtr, 2)}</span>
                </td>
                <td>{totCpc == null ? "—" : fmtSGD(totCpc, { withCents: "always" })}</td>
                <td>
                  {fmtInt(tot.leads)}
                  <span className={styles.submetric}>{fmtPct(totC2L, 1)}</span>
                </td>
                <td>{totCpl == null ? "—" : fmtSGD(totCpl)}</td>
                <td>{fmtSGD(tot.revenue, { withCents: "never" })}</td>
                <td>
                  <span className={styles.roasCell}>
                    <span
                      className={styles.v}
                      style={
                        {
                          "--roas-depth": Math.min(1, totRoas / roasMax).toFixed(2),
                        } as React.CSSProperties
                      }
                    >
                      {totRoas.toFixed(2)}×
                    </span>
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className={styles.tblCards}>
          {sorted.map((c) => (
            <div className={styles.campCard} key={c.name}>
              <div className={styles.top}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.roasCell}>
                  <span
                    className={styles.v}
                    style={
                      {
                        "--roas-depth": Math.min(1, (c.roas ?? 0) / roasMax).toFixed(2),
                      } as React.CSSProperties
                    }
                  >
                    {(c.roas ?? 0).toFixed(2)}×
                  </span>
                </span>
              </div>
              <div className={styles.grid}>
                <div>
                  <label>Spend</label>
                  <span className={styles.v}>{fmtSGD(c.spend, { withCents: "never" })}</span>
                </div>
                <div>
                  <label>Revenue</label>
                  <span className={styles.v}>
                    {c.revenue > 0 ? fmtSGD(c.revenue, { withCents: "never" }) : "—"}
                  </span>
                </div>
                <div>
                  <label>Clicks · CTR</label>
                  <span className={styles.v}>
                    {fmtInt(c.inlineLinkClicks)} · {fmtPct(c.inlineLinkClickCtr, 1)}
                  </span>
                </div>
                <div>
                  <label>Leads · CPL</label>
                  <span className={styles.v}>
                    {fmtInt(c.leads)} · {c.cpl == null ? "—" : fmtSGD(c.cpl)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
