/* /approvals — page shell, state, tweaks */
const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA } = React;

const RISKS = ["low", "medium", "high", "critical"];

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

function ApprovalsApp(){
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "state": "normal",
    "expiringOnly": false,
    "loading": false,
    "errorMode": false
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const data = window.APPROVALS_DATA;
  window.APPROVALS_LAST_CLEARED = "13m ago";

  // live clock (1s ticks)
  const [now, setNow] = useStateA(Date.now());
  useEffectA(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const [activeId, setActiveId] = useStateA(data.pending[0].id);
  const [filter, setFilter] = useStateA("all");      // all | low | medium | high | critical
  const [expiringOnly, setExpiringOnly] = useStateA(false);
  const [responses, setResponses] = useStateA({});

  // Sync expiringOnly from tweak
  useEffectA(() => { setExpiringOnly(!!tweaks.expiringOnly); }, [tweaks.expiringOnly]);

  // Scenario tweaks
  const scenarioEmpty = tweaks.state === "empty";
  const scenarioRecovery = tweaks.state === "recovery";
  const scenarioExpired = tweaks.state === "expired";
  const scenarioPatch = tweaks.state === "patch-flow";
  const scenarioQuorum23 = tweaks.state === "quorum-2of3";
  const scenarioQuorum12 = tweaks.state === "quorum-1of2";
  const loading = !!tweaks.loading;
  const errorMode = !!tweaks.errorMode;

  // Apply scenario-shaped item targeting
  useEffectA(() => {
    if (scenarioEmpty) { setActiveId(null); return; }
    if (scenarioRecovery) { setActiveId("apr_e0c4a5"); return; }
    if (scenarioPatch) { setActiveId("apr_d77c20"); return; }
    if (scenarioQuorum23) { setActiveId("apr_9b73c1"); return; }
    if (scenarioQuorum12) { setActiveId("apr_4e082a"); return; }
    if (scenarioExpired) { setActiveId("apr_2f1a08"); return; }
    if (!activeId || !data.pending.find(r => r.id === activeId)) {
      setActiveId(data.pending[0].id);
    }
  }, [tweaks.state]);

  // Mutate items for scenarios
  const items = useMemoA(() => {
    let list = data.pending.slice();
    if (scenarioEmpty) return [];
    if (scenarioExpired) {
      list = list.map(r => r.id === "apr_2f1a08" ? { ...r, expiresAt: now - 12_000 } : r);
    }
    return list;
  }, [data, scenarioEmpty, scenarioExpired, now]);

  // counts per risk
  const counts = useMemoA(() => {
    const c = { all: items.length, low: 0, medium: 0, high: 0, critical: 0 };
    items.forEach(r => { c[r.riskCategory] = (c[r.riskCategory] || 0) + 1; });
    return c;
  }, [items]);

  // filter
  const filtered = useMemoA(() => {
    let out = items;
    if (filter !== "all") out = out.filter(r => r.riskCategory === filter);
    if (expiringOnly) out = out.filter(r => r.expiresAt - now < 60 * 60 * 1000);
    // sort: critical first, then by expiresAt ascending
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    out = out.slice().sort((a, b) => {
      const ra = rank[a.riskCategory] ?? 9, rb = rank[b.riskCategory] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.expiresAt - b.expiresAt;
    });
    return out;
  }, [items, filter, expiringOnly, now]);

  // auto-pick if active filtered out
  useEffectA(() => {
    if (filtered.length === 0) { setActiveId(null); return; }
    if (!activeId || !filtered.find(r => r.id === activeId)) {
      setActiveId(filtered[0].id);
    }
  }, [filtered, activeId]);

  const active = items.find(r => r.id === activeId) || null;

  function handleRespond(payload){
    setResponses(r => ({ ...r, [active.id]: payload }));
  }

  const expiringSoonCount = items.filter(r => r.expiresAt - now < 60 * 60 * 1000).length;

  return (
    <div className="approvals">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand-cluster">
            <span className="brand-mark">
              <SwitchboardMark />
              Switchboard
            </span>
            <span className="brand-sep">/</span>
            <span className="brand-org">{data.org}</span>
            <span className="brand-sep">/</span>
            <span className="brand-page">Approvals</span>
          </div>
          <div className="topbar-right">
            <span className="live-pip">audit log live</span>
            <span>SGT · {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="topbar-user">
              <span className="me">{data.currentUser.initials}</span>
              <span>{data.currentUser.display}</span>
            </span>
          </div>
        </div>
      </header>

      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Mercury Tools &middot; /approvals</span>
          <h1 className="page-title">
            One decision <span className="accent">at a time.</span>
          </h1>
          <p className="page-sub">
            Every agent-proposed mutation sits here until you sign it. Each row is bound to a cryptographic hash &mdash; you authorize the hash, not the button. Patch, approve, or reject.
          </p>
        </div>
        <div className="page-meta">
          <div className="stat-tile">
            <span className="eyebrow">pending</span>
            <span className="v" data-tabular>{items.length}</span>
            <span className="sub">across {Object.keys(items.reduce((a,r)=>({...a,[r.riskCategory]:1}),{})).length} risk tiers</span>
          </div>
          <div className="stat-tile accent">
            <span className="eyebrow">&lt; 1h to expiry</span>
            <span className="v" data-tabular>{expiringSoonCount}</span>
            <span className="sub">act before window closes</span>
          </div>
          <div className="stat-tile">
            <span className="eyebrow">last cleared</span>
            <span className="v">13m</span>
            <span className="sub">ago &middot; queue average 2m 14s</span>
          </div>
        </div>
      </div>

      <div className="filterstrip">
        <span className="eyebrow">filter</span>
        <button className={"fchip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>
          all <span className="ct">{counts.all}</span>
        </button>
        {RISKS.map(r => (
          <button
            key={r}
            data-cat={r}
            className={"fchip" + (filter === r ? " on" : "")}
            onClick={() => setFilter(r)}
          >
            <span className="fchip-bullet" />
            {r} <span className="ct">{counts[r] || 0}</span>
          </button>
        ))}
        <button
          className={"fchip" + (expiringOnly ? " on" : "")}
          onClick={() => { setExpiringOnly(v => !v); setTweak("expiringOnly", !expiringOnly); }}
        >
          expiring &lt; 60m <span className="ct">{expiringSoonCount}</span>
        </button>

        <span className="filter-spacer" />
        <span className="filter-right">
          <span className="eyebrow">sort</span>
          <button className="sort-toggle">risk · then expiry</button>
        </span>
      </div>

      <main className="split">
        <aside className="split-left">
          <Queue
            items={filtered}
            activeId={active && active.id}
            onSelect={setActiveId}
            loading={loading}
            now={now}
          />
        </aside>
        <section className="split-right">
          <Detail
            req={active}
            currentUser={data.currentUser}
            onRespond={handleRespond}
            response={active ? responses[active.id] : null}
            now={now}
            error={errorMode ? "POST /api/approvals/respond timed out after 8s. Your envelope is unsigned; retry is safe." : null}
            onRetry={() => setTweak("errorMode", false)}
          />
        </section>
      </main>

      <TweaksPanel>
        <TweakSection label="Scenario" />
        <TweakSelect
          label="Page state"
          value={tweaks.state}
          options={[
            { value: "normal", label: "Normal queue" },
            { value: "patch-flow", label: "Worked patch — 10% → 25%" },
            { value: "quorum-1of2", label: "Quorum 1 of 2 (DB rotate)" },
            { value: "quorum-2of3", label: "Quorum 2 of 3 (SMS broadcast)" },
            { value: "expired", label: "Expired during view" },
            { value: "recovery", label: "Recovery required" },
            { value: "empty", label: "Empty queue" }
          ]}
          onChange={v => setTweak("state", v)}
        />
        <TweakToggle label="Expiring < 60m only" value={!!tweaks.expiringOnly} onChange={v => setTweak("expiringOnly", v)} />

        <TweakSection label="System states" />
        <TweakToggle label="Loading skeleton" value={!!tweaks.loading} onChange={v => setTweak("loading", v)} />
        <TweakToggle label="Network error" value={!!tweaks.errorMode} onChange={v => setTweak("errorMode", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<ApprovalsApp />);
