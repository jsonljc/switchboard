"use client";

import { useState, useMemo } from "react";
import { fmtSGD, fmtInt, fmtPct } from "@/components/reports-shared/format";
import { fmtRatio } from "./results-model";
import type { CampaignRow } from "./types";
import styles from "./results.module.css";

// ─── Sort helpers ────────────────────────────────────────────────────────────

type SortKey =
  | "name"
  | "spend"
  | "impressions"
  | "inlineLinkClicks"
  | "inlineLinkClickCtr"
  | "costPerInlineLinkClick"
  | "leads"
  | "cpl"
  | "clickToLeadRate"
  | "revenue"
  | "roas";

function sortCampaigns(campaigns: CampaignRow[], key: SortKey, dir: "asc" | "desc"): CampaignRow[] {
  return [...campaigns].sort((a, b) => {
    const av = a[key] ?? (dir === "asc" ? Infinity : -Infinity);
    const bv = b[key] ?? (dir === "asc" ? Infinity : -Infinity);
    if (typeof av === "string" && typeof bv === "string") {
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    const an = av as number;
    const bn = bv as number;
    return dir === "asc" ? an - bn : bn - an;
  });
}

// ─── ROAS bar (amber-only depth) ─────────────────────────────────────────────

function RoasBar({ roas, maxRoas }: { roas: number; maxRoas: number }) {
  const pct = Math.min(roas / maxRoas, 1) * 100;
  return (
    <span className={styles.roasBar}>
      <span className={styles.roasBarFill} style={{ width: `${pct}%` }} />
      <span className={styles.roasBarLabel}>{fmtRatio(roas)}</span>
    </span>
  );
}

// ─── Desktop sort button ──────────────────────────────────────────────────────

function SortBtn({
  label,
  sortKey,
  currentKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  const arrow = active ? (dir === "asc" ? " ↑" : " ↓") : "";
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={styles.campaignSortBtn}
      aria-label={`Sort by ${label}${arrow}`}
    >
      {label}
      {arrow}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CampaignsSection({
  campaigns,
  layout,
}: {
  campaigns: CampaignRow[];
  layout: "mobile" | "desktop";
}) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(
    () => sortCampaigns(campaigns, sortKey, sortDir),
    [campaigns, sortKey, sortDir],
  );

  const totals = useMemo(() => {
    const spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const impressions = campaigns.reduce((s, c) => s + c.impressions, 0);
    const clicks = campaigns.reduce((s, c) => s + c.inlineLinkClicks, 0);
    const leads = campaigns.reduce((s, c) => s + c.leads, 0);
    const revenue = campaigns.reduce((s, c) => s + c.revenue, 0);
    const roas = spend > 0 ? revenue / spend : 0;
    return { spend, impressions, clicks, leads, revenue, roas };
  }, [campaigns]);

  const maxRoas = useMemo(() => Math.max(...campaigns.map((c) => c.roas ?? 0), 1), [campaigns]);

  // Empty state
  if (campaigns.length === 0) {
    return (
      <p className={styles.campaignEmpty}>
        No campaign data for this period — connect Meta Ads to populate this.
      </p>
    );
  }

  if (layout === "desktop") {
    return (
      <div className={styles.campaignTableWrap}>
        <table className={styles.campaignTable}>
          <thead>
            <tr>
              <th className={styles.campaignThSticky}>
                <SortBtn
                  label="Campaign"
                  sortKey="name"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="Spend"
                  sortKey="spend"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="Impr"
                  sortKey="impressions"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="Clicks"
                  sortKey="inlineLinkClicks"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="CTR"
                  sortKey="inlineLinkClickCtr"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="CPC"
                  sortKey="costPerInlineLinkClick"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="Leads"
                  sortKey="leads"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="CPL"
                  sortKey="cpl"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="C→L"
                  sortKey="clickToLeadRate"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignTh}>
                <SortBtn
                  label="Revenue"
                  sortKey="revenue"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
              <th className={styles.campaignThRoas}>
                <SortBtn
                  label="ROAS"
                  sortKey="roas"
                  currentKey={sortKey}
                  dir={sortDir}
                  onClick={handleSort}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.name} className={styles.campaignRow}>
                <td className={styles.campaignTdSticky}>{c.name}</td>
                <td className={styles.campaignTdNum}>{fmtSGD(c.spend)}</td>
                <td className={styles.campaignTdNum}>{fmtInt(c.impressions)}</td>
                <td className={styles.campaignTdNum}>{fmtInt(c.inlineLinkClicks)}</td>
                <td className={styles.campaignTdNum}>{fmtPct(c.inlineLinkClickCtr)}</td>
                <td className={styles.campaignTdNum}>
                  {fmtSGD(c.costPerInlineLinkClick, { withCents: "always" })}
                </td>
                <td className={styles.campaignTdNum}>{fmtInt(c.leads)}</td>
                <td className={styles.campaignTdNum}>
                  {c.cpl != null ? fmtSGD(c.cpl, { withCents: "always" }) : "—"}
                </td>
                <td className={styles.campaignTdNum}>
                  {c.clickToLeadRate != null ? fmtPct(c.clickToLeadRate) : "—"}
                </td>
                <td className={styles.campaignTdNum}>{fmtSGD(c.revenue)}</td>
                <td className={styles.campaignTdRoas}>
                  <RoasBar roas={c.roas} maxRoas={maxRoas} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.campaignFooterRow}>
              <td className={styles.campaignTdSticky}>Total</td>
              <td className={styles.campaignTdNum}>{fmtSGD(totals.spend)}</td>
              <td className={styles.campaignTdNum}>{fmtInt(totals.impressions)}</td>
              <td className={styles.campaignTdNum}>{fmtInt(totals.clicks)}</td>
              <td className={styles.campaignTdNum}>—</td>
              <td className={styles.campaignTdNum}>—</td>
              <td className={styles.campaignTdNum}>{fmtInt(totals.leads)}</td>
              <td className={styles.campaignTdNum}>—</td>
              <td className={styles.campaignTdNum}>—</td>
              <td className={styles.campaignTdNum}>{fmtSGD(totals.revenue)}</td>
              <td className={styles.campaignTdRoas}>{fmtRatio(totals.roas)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // Mobile card list
  const mobileSortKeys: { label: string; key: SortKey }[] = [
    { label: "Revenue", key: "revenue" },
    { label: "ROAS", key: "roas" },
    { label: "Leads", key: "leads" },
    { label: "Spend", key: "spend" },
  ];

  return (
    <div className={styles.campaignCards}>
      {/* Sort control row */}
      <div className={styles.campaignMobileSortRow}>
        {mobileSortKeys.map(({ label, key }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleSort(key)}
            className={
              sortKey === key ? styles.campaignMobileSortActive : styles.campaignMobileSortChip
            }
            aria-label={`Sort by ${label}`}
          >
            {label}
            {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
        ))}
      </div>

      {/* Campaign cards */}
      <ol className={styles.campaignCardList}>
        {sorted.map((c, i) => (
          <li key={c.name} className={styles.campaignCard}>
            <div className={styles.campaignCardHeader}>
              <span className={styles.campaignCardRank}>{i + 1}</span>
              <span className={styles.campaignCardName}>{c.name}</span>
            </div>
            <RoasBar roas={c.roas} maxRoas={maxRoas} />
            <dl className={styles.campaignCardStats}>
              <div className={styles.campaignCardStat}>
                <dt className={styles.campaignCardStatLabel}>Revenue</dt>
                <dd className={styles.campaignCardStatVal}>{fmtSGD(c.revenue)}</dd>
              </div>
              <div className={styles.campaignCardStat}>
                <dt className={styles.campaignCardStatLabel}>Spend</dt>
                <dd className={styles.campaignCardStatVal}>{fmtSGD(c.spend)}</dd>
              </div>
              <div className={styles.campaignCardStat}>
                <dt className={styles.campaignCardStatLabel}>Leads</dt>
                <dd className={styles.campaignCardStatVal}>{fmtInt(c.leads)}</dd>
              </div>
              <div className={styles.campaignCardStat}>
                <dt className={styles.campaignCardStatLabel}>CPL</dt>
                <dd className={styles.campaignCardStatVal}>
                  {c.cpl != null ? fmtSGD(c.cpl, { withCents: "always" }) : "—"}
                </dd>
              </div>
              <div className={styles.campaignCardStat}>
                <dt className={styles.campaignCardStatLabel}>Clicks</dt>
                <dd className={styles.campaignCardStatVal}>{fmtInt(c.inlineLinkClicks)}</dd>
              </div>
              <div className={styles.campaignCardStat}>
                <dt className={styles.campaignCardStatLabel}>CTR</dt>
                <dd className={styles.campaignCardStatVal}>{fmtPct(c.inlineLinkClickCtr)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </div>
  );
}
