/* /reports — section components.
   Each section is editorial: eyebrow, content, hairline rules.
   All money values arrive in SGD cents; fmtSGD formats correctly. */

const { useState: useStateR, useMemo: useMemoR, useEffect: useEffectR } = React;

// ─── Currency helper (SGD cents → "S$X,XXX[.XX]") ─────────────────────────
function fmtSGD(cents, opts = {}) {
  const { withCents = "auto", compact = false } = opts;
  if (cents == null) return "—";
  const dollars = cents / 100;
  const showCents = withCents === "always"
    ? true
    : withCents === "never"
      ? false
      : Math.abs(dollars) < 100;
  if (compact && Math.abs(dollars) >= 1_000_000) {
    return "S$" + (dollars / 1_000_000).toFixed(1) + "m";
  }
  if (compact && Math.abs(dollars) >= 10_000) {
    return "S$" + (dollars / 1_000).toFixed(0) + "k";
  }
  return "S$" + dollars.toLocaleString("en-SG", {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

function fmtPct(x, digits = 2) {
  if (x == null) return "—";
  return (x * 100).toFixed(digits) + "%";
}

function fmtInt(n) {
  if (n == null) return "—";
  return n.toLocaleString("en-SG");
}

function fmtIntCompact(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "m";
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toLocaleString("en-SG");
}

window.fmtSGD = fmtSGD;
window.fmtPct = fmtPct;
window.fmtInt = fmtInt;

// ─── Delta badge ──────────────────────────────────────────────────────────
function DeltaBadge({ delta, size = "md" }) {
  if (!delta) return null;
  const kind = delta.kind;
  const arrow = kind === "pos" ? "↑" : kind === "neg" ? "↓" : "—";
  return (
    <span className={`delta-badge ${kind}`}>
      <span className="arrow">{arrow}</span>
      <span>{delta.text.replace(/^[↑↓—]\s*/, "")}</span>
    </span>
  );
}

// ─── Pull quote ───────────────────────────────────────────────────────────
function PullQuote({ q }) {
  return (
    <div className="pullquote-wrap">
      <p className="pullquote fade-in" key={q.value + q.cost}>
        {q.pre}
        <span className="em">{q.value}</span>
        {q.mid}
        <span className="em">{q.cost}</span>
        {q.post}
      </p>
    </div>
  );
}

// ─── Attribution ──────────────────────────────────────────────────────────
function Attribution({ data }) {
  // The "hero" number is rendered with a small superscript "S$"
  const dollars = (data.total / 100).toLocaleString("en-SG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  // share of total
  const rileyShare = data.riley.value / Math.max(1, data.total);
  const alexShare = data.alex.value / Math.max(1, data.total);

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">Attributed pipeline</span>
        <span className="right">total this period</span>
      </div>

      <div className="attr-block">
        <div className="attr-hero">
          <div className="attr-num fade-in" key={data.total}>
            <span className="sgd">S$</span>{dollars}
          </div>
          <div className="attr-aside">
            <span className="label">vs. previous period</span>
            <DeltaBadge delta={data.delta} />
            <p className="desc">
              Pipeline value attributed by closed bookings, weighted by service price at the point of sale.
            </p>
          </div>
        </div>

        <div className="attr-split">
          <div className="attr-card riley">
            <div className="who">
              <span className="who-glyph">R</span>
              <span className="who-name">Riley</span>
              <span className="who-role">Ad-ops</span>
            </div>
            <div className="val fade-in" key={data.riley.value}>{fmtSGD(data.riley.value, { withCents: "never" })}</div>
            <div className="cap">{data.riley.caption}</div>
            <div className="share-line">
              <div className="share-bar"><span style={{ width: (rileyShare * 100).toFixed(1) + "%" }} /></div>
              <span className="share-pct">{(rileyShare * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div className="attr-card alex">
            <div className="who">
              <span className="who-glyph">A</span>
              <span className="who-name">Alex</span>
              <span className="who-role">Conversations</span>
            </div>
            <div className="val fade-in" key={data.alex.value}>{fmtSGD(data.alex.value, { withCents: "never" })}</div>
            <div className="cap">{data.alex.caption}</div>
            <div className="share-line">
              <div className="share-bar"><span style={{ width: (alexShare * 100).toFixed(1) + "%" }} /></div>
              <span className="share-pct">{(alexShare * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Funnel ───────────────────────────────────────────────────────────────
function Funnel({ rows, narrative }) {
  const maxN = Math.max(...rows.map(r => r.n));
  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">Funnel</span>
        <span className="right">five stages · proportional</span>
      </div>

      <div className="funnel">
        {rows.map((r, i) => {
          const pct = (r.n / maxN) * 100;
          const dKind = r.delta?.kind || "flat";
          return (
            <div className="funnel-table" data-i={i} key={r.stage}>
              <span className="funnel-stage">{r.stage}</span>
              <span className="funnel-bar" aria-hidden="true">
                <span className="fill" style={{ width: pct.toFixed(2) + "%" }} />
              </span>
              <span className="funnel-num">{r.label}</span>
              <span className={`funnel-delta ${dKind}`}>
                {r.delta ? r.delta.text : <span style={{ color: "var(--ink-5)" }}>—</span>}
              </span>
            </div>
          );
        })}

        <div className="funnel-byline">
          <span className="marker">{narrative.marker}</span>
          <p className="text">{narrative.text}</p>
        </div>
      </div>
    </section>
  );
}

// ─── Campaigns table ──────────────────────────────────────────────────────
const COLS = [
  { id: "name",                    label: "Campaign",  sub: null,           num: false, sortable: true },
  { id: "spend",                   label: "Spend",     sub: "SGD",          num: true,  sortable: true },
  { id: "impressions",             label: "Impr.",     sub: null,           num: true,  sortable: true },
  { id: "inlineLinkClicks",        label: "Clicks",    sub: "CTR",          num: true,  sortable: true },
  { id: "costPerInlineLinkClick",  label: "CPC",       sub: null,           num: true,  sortable: true },
  { id: "leads",                   label: "Leads",     sub: "Click→Lead",   num: true,  sortable: true },
  { id: "cpl",                     label: "CPL",       sub: null,           num: true,  sortable: true },
  { id: "revenue",                 label: "Revenue",   sub: "SGD",          num: true,  sortable: true },
  { id: "roas",                    label: "ROAS",      sub: "rev/spend",    num: true,  sortable: true },
];

function CampaignsTable({ campaigns }) {
  const [sortCol, setSortCol] = useStateR("revenue");
  const [sortDir, setSortDir] = useStateR("desc");

  // ROAS depth — calibrate against best in the set
  const roasMax = Math.max(...campaigns.map(c => c.roas || 0), 1);

  const sorted = useMemoR(() => {
    const arr = [...campaigns];
    arr.sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [campaigns, sortCol, sortDir]);

  function clickHeader(col) {
    if (!col.sortable) return;
    if (sortCol === col.id) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col.id);
      setSortDir(col.num ? "desc" : "asc");
    }
  }

  // Totals
  const tot = campaigns.reduce((a, c) => ({
    spend: a.spend + (c.spend || 0),
    impressions: a.impressions + (c.impressions || 0),
    inlineLinkClicks: a.inlineLinkClicks + (c.inlineLinkClicks || 0),
    leads: a.leads + (c.leads || 0),
    revenue: a.revenue + (c.revenue || 0),
  }), { spend: 0, impressions: 0, inlineLinkClicks: 0, leads: 0, revenue: 0 });
  const totRoas = tot.spend > 0 ? tot.revenue / tot.spend : 0;
  const totCpc = tot.inlineLinkClicks > 0 ? Math.round(tot.spend / tot.inlineLinkClicks) : null;
  const totCpl = tot.leads > 0 ? Math.round(tot.spend / tot.leads) : null;
  const totCtr = tot.impressions > 0 ? tot.inlineLinkClicks / tot.impressions : 0;
  const totC2L = tot.inlineLinkClicks > 0 ? tot.leads / tot.inlineLinkClicks : 0;

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">Campaigns</span>
        <span className="right">{campaigns.length} · sort by revenue (default)</span>
      </div>

      <div className="tbl-wrap">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                {COLS.map(c => (
                  <th
                    key={c.id}
                    className={
                      (c.id === "name" ? "name " : "") +
                      (c.sortable ? "sortable " : "") +
                      (sortCol === c.id ? "active " + sortDir : "")
                    }
                    onClick={() => clickHeader(c)}
                    title={c.sortable ? "Click to sort" : undefined}
                  >
                    {c.label}
                    {c.sortable && <span className="arrow">↓</span>}
                    {c.sub && <span className="sub">{c.sub}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => {
                const roasDepth = c.roas != null ? Math.min(1, c.roas / roasMax) : 0;
                const isDead = (c.inlineLinkClicks === 0) || (c.roas === 0 && c.leads === 0);
                return (
                  <tr key={c.name}>
                    <td className="name">{c.name}</td>
                    <td>{fmtSGD(c.spend, { withCents: "never" })}</td>
                    <td>{fmtInt(c.impressions)}</td>
                    <td>
                      {fmtInt(c.inlineLinkClicks)}
                      <span className="submetric">{fmtPct(c.inlineLinkClickCtr, 2)} CTR</span>
                    </td>
                    <td className={c.costPerInlineLinkClick == null ? "muted" : ""}>
                      {c.costPerInlineLinkClick == null ? "—" : fmtSGD(c.costPerInlineLinkClick, { withCents: "always" })}
                    </td>
                    <td>
                      {fmtInt(c.leads)}
                      <span className="submetric">{fmtPct(c.clickToLeadRate, 1)}</span>
                    </td>
                    <td className={c.cpl == null ? "muted" : ""}>
                      {c.cpl == null ? "—" : fmtSGD(c.cpl, { withCents: c.cpl < 10_000 ? "always" : "never" })}
                    </td>
                    <td>{c.revenue > 0 ? fmtSGD(c.revenue, { withCents: "never" }) : <span style={{color:"var(--ink-4)"}}>—</span>}</td>
                    <td>
                      <span className={"roas-cell" + (isDead ? " dead" : "")}>
                        <span className="v" style={{ "--roas-depth": roasDepth.toFixed(2) }}>
                          {(c.roas || 0).toFixed(2)}×
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="name">TOTAL · {campaigns.length} campaigns</td>
                <td>{fmtSGD(tot.spend, { withCents: "never" })}</td>
                <td>{fmtInt(tot.impressions)}</td>
                <td>{fmtInt(tot.inlineLinkClicks)} <span className="submetric" style={{ color: "var(--ink-3)" }}>{fmtPct(totCtr, 2)}</span></td>
                <td>{totCpc == null ? "—" : fmtSGD(totCpc, { withCents: "always" })}</td>
                <td>{fmtInt(tot.leads)} <span className="submetric" style={{ color: "var(--ink-3)" }}>{fmtPct(totC2L, 1)}</span></td>
                <td>{totCpl == null ? "—" : fmtSGD(totCpl, { withCents: totCpl < 10_000 ? "always" : "never" })}</td>
                <td>{fmtSGD(tot.revenue, { withCents: "never" })}</td>
                <td>
                  <span className="roas-cell">
                    <span className="v" style={{ "--roas-depth": Math.min(1, totRoas / roasMax).toFixed(2) }}>
                      {totRoas.toFixed(2)}×
                    </span>
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile fallback */}
        <div className="tbl-cards">
          {sorted.map(c => (
            <div className="camp-card" key={c.name}>
              <div className="top">
                <span className="name">{c.name}</span>
                <span className="roas-cell">
                  <span className="v" style={{ "--roas-depth": Math.min(1, (c.roas || 0) / roasMax).toFixed(2) }}>
                    {(c.roas || 0).toFixed(2)}×
                  </span>
                </span>
              </div>
              <div className="grid">
                <div><label>Spend</label><span className="v">{fmtSGD(c.spend, { withCents: "never" })}</span></div>
                <div><label>Revenue</label><span className="v">{c.revenue > 0 ? fmtSGD(c.revenue, { withCents: "never" }) : "—"}</span></div>
                <div><label>Clicks · CTR</label><span className="v">{fmtInt(c.inlineLinkClicks)} · {fmtPct(c.inlineLinkClickCtr, 1)}</span></div>
                <div><label>Leads · CPL</label><span className="v">{fmtInt(c.leads)} · {c.cpl == null ? "—" : fmtSGD(c.cpl, { withCents: "always" })}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Cost vs Value (renewal punchline) ────────────────────────────────────
function CostVsValue({ cost, narrative }) {
  const savingDollars = (cost.saving / 100).toLocaleString("en-SG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">Cost vs. value</span>
        <span className="right">the renewal arithmetic</span>
      </div>

      <div className="cost-block">
        <div className="cost-three">
          <div className="cost-cell paid">
            <span className="label">You pay</span>
            <span className="v">{fmtSGD(cost.paid, { withCents: cost.paid < 10_000 ? "always" : "never" })}</span>
            <span className="sub">Switchboard subscription, this period</span>
          </div>
          <div className="cost-cell alt">
            <span className="label">SDR + agency alt.</span>
            <span className="v">{fmtSGD(cost.alt, { withCents: "never" })}</span>
            <span className="sub">market-rate equivalent</span>
          </div>
          <div className="cost-cell saving">
            <span className="label">Monthly saving</span>
            <span className="v"><span className="sgd">S$</span>{savingDollars}</span>
            <span className="sub">net to your P&amp;L</span>
          </div>
        </div>
        <p className="cost-narrative">{narrative}</p>
      </div>
    </section>
  );
}

// ─── Managed comparison ───────────────────────────────────────────────────
function ManagedComparison({ data }) {
  if (!data) return null;

  const adRoasDelta = data.ads.roas.managed - data.ads.roas.unmanaged;
  const adRoasDeltaPct = (data.ads.roas.unmanaged > 0)
    ? ((data.ads.roas.managed / data.ads.roas.unmanaged) - 1) * 100
    : null;

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">Managed vs. unmanaged</span>
        <span className="right">cohort comparison · same-period</span>
      </div>

      <div className="mc-wrap">
        <div className="mc-grid">
          {/* Ads block */}
          <div className="mc-col">
            <div className="col-eyebrow">Ads</div>

            <div className="mc-metric">
              <span className="label">Spend</span>
              <div className="mc-side managed">
                <span className="who">Managed</span>
                <span className="v">{fmtSGD(data.ads.spend.managed, { withCents: "never" })}</span>
              </div>
              <div className="mc-side unmanaged">
                <span className="who">Unmanaged</span>
                <span className="v">{fmtSGD(data.ads.spend.unmanaged, { withCents: "never" })}</span>
              </div>
            </div>

            <div className="mc-metric">
              <span className="label">Revenue</span>
              <div className="mc-side managed">
                <span className="who">Managed</span>
                <span className="v">{fmtSGD(data.ads.revenue.managed, { withCents: "never" })}</span>
              </div>
              <div className="mc-side unmanaged">
                <span className="who">Unmanaged</span>
                <span className="v">{fmtSGD(data.ads.revenue.unmanaged, { withCents: "never" })}</span>
              </div>
            </div>

            <div className="mc-metric">
              <span className="label">ROAS</span>
              <div className="mc-side managed">
                <span className="who">Managed</span>
                <span className="v">{data.ads.roas.managed.toFixed(2)}×</span>
                {adRoasDeltaPct != null && (
                  <span className="delta">{adRoasDeltaPct > 0 ? "↑" : "↓"} {Math.abs(adRoasDeltaPct).toFixed(0)}% vs unmanaged</span>
                )}
              </div>
              <div className="mc-side unmanaged">
                <span className="who">Unmanaged</span>
                <span className="v">{data.ads.roas.unmanaged.toFixed(2)}×</span>
              </div>
            </div>
          </div>

          {/* Conversations block */}
          <div className="mc-col">
            <div className="col-eyebrow">Conversations</div>

            <div className="mc-metric">
              <span className="label">Replies handled</span>
              <div className="mc-side managed">
                <span className="who">Managed</span>
                <span className="v">{fmtInt(data.conversations.replies.managed)}</span>
              </div>
              <div className="mc-side unmanaged">
                <span className="who">Unmanaged</span>
                <span className="v">{fmtInt(data.conversations.replies.unmanaged)}</span>
              </div>
            </div>

            <div className="mc-metric">
              <span className="label">Conversion rate</span>
              <div className="mc-side managed">
                <span className="who">Managed</span>
                <span className="v">{fmtPct(data.conversations.conversionRate.managed, 1)}</span>
              </div>
              <div className="mc-side unmanaged">
                <span className="who">Unmanaged</span>
                <span className="v">{fmtPct(data.conversations.conversionRate.unmanaged, 1)}</span>
              </div>
            </div>

            <div className="mc-metric">
              <span className="label">Median reply time</span>
              <div className="mc-side managed">
                <span className="who">Managed</span>
                <span className="v">{data.conversations.replyMinutesP50.managed}<span style={{fontSize:"0.5em",marginLeft:"4px",color:"var(--ink-3)"}}>min</span></span>
              </div>
              <div className="mc-side unmanaged">
                <span className="who">Unmanaged</span>
                <span className="v">{data.conversations.replyMinutesP50.unmanaged}<span style={{fontSize:"0.5em",marginLeft:"4px",color:"var(--ink-3)"}}>min</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Colophon (footer) ────────────────────────────────────────────────────
function Colophon({ report, meta, generatedAt }) {
  const gen = new Date(generatedAt);
  return (
    <footer className="colophon">
      <div className="left">
        <span className="eyebrow">Colophon</span>
        <span className="period">{report.period}</span>
        <span className="caveat">
          Attributed pipeline reflects bookings whose lead source resolved to a Switchboard-managed
          channel within the 30-day attribution window. Revenue is recognised at the point of booking,
          not the point of service. Cost comparisons are illustrative, based on Singapore-market median
          salary plus typical retainer.
        </span>
      </div>
      <div className="right">
        <span className={"mode " + (meta.liveMode ? "live" : "")}>
          <span className="dot" /> {meta.liveMode ? "Live data" : "Sample data"}
        </span>
        <span>generated <b>{gen.toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}</b></span>
        <span>org · <b>{meta.org}</b></span>
        <span>schema · <b>reports/v1</b></span>
      </div>
    </footer>
  );
}

window.PullQuote = PullQuote;
window.Attribution = Attribution;
window.Funnel = Funnel;
window.CampaignsTable = CampaignsTable;
window.CostVsValue = CostVsValue;
window.ManagedComparison = ManagedComparison;
window.Colophon = Colophon;
window.DeltaBadge = DeltaBadge;
