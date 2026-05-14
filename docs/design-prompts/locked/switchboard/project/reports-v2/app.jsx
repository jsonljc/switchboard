/* /reports — page shell. Topbar, header (title + date folio + window selector),
   and the editorial flow of sections beneath. Tweaks panel exposes window,
   fixture, and managed-comparison presence for the user to probe. */

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA } = React;

function SwitchboardMark(){
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill="#0E0C0A" />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path d="M 7 11 Q 11 6.5, 15 11" stroke="hsl(30 55% 46%)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function ReportsApp(){
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "window": "THIS MONTH",
    "liveMode": false,
    "noConnectionBanner": false,
    "hideManagedComparison": false,
    "scenario": "normal"
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const fixtures = window.REPORTS_FIXTURES;
  const meta = window.REPORTS_META;

  // ── Window state ───────────────────────────────────────────────────────
  const [activeWindow, setActiveWindow] = useStateA(tweaks.window);
  useEffectA(() => { setActiveWindow(tweaks.window); }, [tweaks.window]);

  const [cacheAge, setCacheAge] = useStateA(meta.cacheAgeMin);
  const [recomputing, setRecomputing] = useStateA(false);
  useEffectA(() => {
    const t = setInterval(() => setCacheAge(a => a + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Tick clock for header
  const [now, setNow] = useStateA(() => Date.now());
  useEffectA(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function changeWindow(w){
    setActiveWindow(w);
    setTweak("window", w);
  }

  function recompute(){
    if (recomputing) return;
    setRecomputing(true);
    setTimeout(() => {
      setCacheAge(0);
      setRecomputing(false);
    }, 900);
  }

  // ── Build the active report (with tweak overrides) ─────────────────────
  const report = useMemoA(() => {
    const base = fixtures[activeWindow];
    if (!base) return null;
    let r = base;
    if (tweaks.hideManagedComparison) r = { ...r, managedComparison: null };
    return r;
  }, [activeWindow, fixtures, tweaks.hideManagedComparison]);

  const liveMode = !!tweaks.liveMode;
  const showNoConnBanner = liveMode && tweaks.noConnectionBanner;

  return (
    <div className="reports">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand-cluster">
            <span className="brand-mark">
              <SwitchboardMark />
              Switchboard
            </span>
            <span className="brand-sep">/</span>
            <span className="brand-org">{meta.org}</span>
            <span className="brand-sep">/</span>
            <span className="brand-page">Reports</span>
          </div>
          <div className="topbar-right">
            <span className={"live-pip " + (liveMode ? "" : "fixture")}>
              {liveMode ? "live data" : "sample data"}
            </span>
            <span>SGT &middot; {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="topbar-user">
              <span className="me">{meta.currentUser.initials}</span>
              <span>{meta.currentUser.display}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Page header */}
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Statement · /reports</span>
          <h1 className="page-title">
            Operator's <span className="accent">Statement.</span>
          </h1>
          <p className="page-sub">
            A renewal-checkpoint reading of what your two agents earned you this period, what they cost,
            and what the equivalent in headcount would have run. Read top to bottom — the cost arithmetic
            sits near the end on purpose.
          </p>
        </div>
        <div className="right">
          <span className="date-folio">{report.dateFolio}</span>
          <div className="window-seg" role="group" aria-label="Report window">
            {["THIS WEEK", "THIS MONTH", "THIS QUARTER"].map(w => (
              <button
                key={w}
                className={activeWindow === w ? "on" : ""}
                onClick={() => changeWindow(w)}
              >
                {w}
              </button>
            ))}
          </div>
          <div className="recompute">
            <button
              className={"btn" + (recomputing ? " spinning" : "")}
              onClick={recompute}
              disabled={recomputing}
              title="POST /api/dashboard/reports/refresh"
            >
              {recomputing
                ? <><span className="spinner" />Recomputing…</>
                : <>Recompute</>
              }
            </button>
            <span>cached <b>{cacheAge === 0 ? "just now" : `${cacheAge}m ago`}</b></span>
          </div>
        </div>
      </div>

      {/* No-connection banner (live mode only) */}
      {showNoConnBanner && (
        <div className="banner-noconn">
          <span className="eyebrow">no meta ads connection</span>
          <span className="msg">
            Campaigns and funnel will read zero until a Meta Ads connection is reattached. Stripe and
            booking data continue to feed the attribution number above.
          </span>
          <a className="cta" href="#settings">Connect under Settings</a>
        </div>
      )}

      {/* Pull quote — sits BETWEEN header and attribution as the editorial lede */}
      <PullQuote q={report.pullquote} />

      {/* Attribution */}
      <Attribution data={report.attribution} />

      {/* Funnel */}
      <Funnel rows={report.funnel} narrative={report.funnelNarrative} />

      {/* Campaigns */}
      <CampaignsTable campaigns={report.campaigns} />

      {/* Cost vs Value — the renewal punchline */}
      <CostVsValue cost={report.cost} narrative={report.costNarrative} />

      {/* Managed comparison — only when present */}
      {report.managedComparison && <ManagedComparison data={report.managedComparison} />}

      {/* Colophon */}
      <Colophon report={report} meta={{ ...meta, liveMode }} generatedAt={meta.generatedAt} />

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Reporting window" />
        <TweakRadio
          label="Window"
          value={tweaks.window}
          options={[
            { value: "THIS WEEK", label: "Week" },
            { value: "THIS MONTH", label: "Month" },
            { value: "THIS QUARTER", label: "Quarter" },
          ]}
          onChange={v => setTweak("window", v)}
        />

        <TweakSection label="Data mode" />
        <TweakToggle
          label="Live mode (NEXT_PUBLIC_REPORTS_LIVE)"
          value={!!tweaks.liveMode}
          onChange={v => setTweak("liveMode", v)}
        />
        <TweakToggle
          label="Missing Meta Ads connection"
          value={!!tweaks.noConnectionBanner}
          onChange={v => setTweak("noConnectionBanner", v)}
        />

        <TweakSection label="Schema variations" />
        <TweakToggle
          label="Hide managedComparison (force null)"
          value={!!tweaks.hideManagedComparison}
          onChange={v => setTweak("hideManagedComparison", v)}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<ReportsApp />);
