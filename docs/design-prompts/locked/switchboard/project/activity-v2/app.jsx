/* /activity — page shell, filter strip, state coverage */
const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useRef: useRefA } = React;

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

// ─────────────────────────────────────────────────────────────────────────
// Event-type combobox
// ─────────────────────────────────────────────────────────────────────────
function EventTypeCombo({ value, onChange, bands, counts }){
  const [open, setOpen] = useStateA(false);
  const [query, setQuery] = useStateA("");
  const wrapRef = useRefA(null);

  useEffectA(() => {
    function onDoc(e){
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const flat = useMemoA(() => {
    const items = [];
    Object.entries(bands).forEach(([band, list]) => {
      list.forEach(et => items.push({ band, et }));
    });
    return items;
  }, [bands]);

  const filtered = useMemoA(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null; // show grouped
    return flat.filter(i => i.et.toLowerCase().includes(q));
  }, [query, flat]);

  function pick(et){
    onChange(et);
    setOpen(false);
    setQuery("");
  }

  function clear(e){
    e.stopPropagation();
    onChange(null);
    setQuery("");
  }

  function highlight(text){
    const q = query.trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <React.Fragment>
        {text.slice(0, idx)}
        <em>{text.slice(idx, idx + q.length)}</em>
        {text.slice(idx + q.length)}
      </React.Fragment>
    );
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        className="combo-input"
        placeholder="event type — type to filter…"
        value={open ? query : (value || "")}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); }}
        spellCheck={false}
      />
      {value && !open && (
        <button className="combo-clear" onClick={clear} aria-label="clear event type">×</button>
      )}
      <span className="combo-caret">▾</span>
      {open && (
        <div className="combo-pop" role="listbox">
          {filtered ? (
            filtered.length === 0 ? (
              <div className="combo-empty">No event type matches “{query}”.</div>
            ) : filtered.map(({ band, et }) => (
              <button key={et} className={"combo-opt" + (value === et ? " selected" : "")} onClick={() => pick(et)}>
                <span>{highlight(et)}</span>
                <span className="ct">{counts[et] || 0}</span>
              </button>
            ))
          ) : (
            Object.entries(bands).map(([band, list]) => (
              <div key={band}>
                <div className="combo-band">{band} <span style={{opacity:0.55, marginLeft:6}}>· {list.length}</span></div>
                {list.map(et => (
                  <button key={et} className={"combo-opt" + (value === et ? " selected" : "")} onClick={() => pick(et)}>
                    <span>{et}</span>
                    <span className="ct">{counts[et] || 0}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Date range picker — text inputs (operator types ISO date; intentional)
// ─────────────────────────────────────────────────────────────────────────
function DateRange({ after, before, onChange }){
  return (
    <div className="daterange">
      <span className="seg">
        <label>after</label>
        <input
          type="date"
          value={after || ""}
          onChange={(e) => onChange({ after: e.target.value || null, before })}
        />
      </span>
      <span className="seg">
        <label>before</label>
        <input
          type="date"
          value={before || ""}
          onChange={(e) => onChange({ after, before: e.target.value || null })}
        />
        {(after || before) && (
          <button className="clear" onClick={() => onChange({ after: null, before: null })} aria-label="clear dates">×</button>
        )}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Entity selector
// ─────────────────────────────────────────────────────────────────────────
function EntitySelector({ entityType, entityId, types, onChange }){
  return (
    <div className="entity-pick">
      <select
        value={entityType || ""}
        onChange={(e) => onChange({ entityType: e.target.value || null, entityId })}
      >
        <option value="">any entity type</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        placeholder="entityId…"
        value={entityId || ""}
        onChange={(e) => onChange({ entityType, entityId: e.target.value || null })}
        spellCheck={false}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────────────────
function ActivityApp(){
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "state": "normal",
    "loading": false,
    "errorMode": false,
    "showStalePill": true
  }/*EDITMODE-END*/;
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const data = window.ACTIVITY_DATA;

  // live clock so "fetched Xm ago" pill stays believable
  const [now, setNow] = useStateA(Date.now());
  useEffectA(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // The page's "view time" is anchored — keyset pagination is stable.
  // We display rows relative to this view time, not wall-clock, so timestamps
  // don't reflow under the reader.
  const VIEW_NOW = data.fetchedAt; // fixed for the snapshot we have

  // ── Filter state ──────────────────────────────────────────────────────
  const [scope, setScope] = useStateA("operational");  // operational | all | custom
  const [eventType, setEventType] = useStateA(null);
  const [actorType, setActorType] = useStateA(null);
  const [dateRange, setDateRange] = useStateA({ after: null, before: null });
  const [entitySel, setEntitySel] = useStateA({ entityType: null, entityId: null });
  const [expandedId, setExpandedId] = useStateA(null);
  const [targetId, setTargetId] = useStateA(null);
  const [refreshing, setRefreshing] = useStateA(false);
  // fetchedAt = when the OPERATOR loaded this page (wall clock), not the fixture
  // anchor. VIEW_NOW is only used for row relative-time formatting so timestamps
  // don't reflow under the reader.
  const [fetchedAt, setFetchedAt] = useStateA(() => Date.now());

  // Tweak-driven scenarios
  useEffectA(() => {
    if (tweaks.state === "empty-filtered") {
      setScope("custom");
      setEventType("delegation.chain_resolved");
      setActorType("user");  // user actor doesn't perform delegation events here
      setDateRange({ after: "2026-05-08", before: "2026-05-09" });
      setEntitySel({ entityType: null, entityId: null });
    } else if (tweaks.state === "empty-zero") {
      // handled below as a hard switch on items
    } else if (tweaks.state === "expanded-critical") {
      setExpandedId("audit_b2l3n4q0");
    } else if (tweaks.state === "all-events") {
      setScope("all");
    } else if (tweaks.state === "filter-action-failed") {
      setScope("custom");
      setEventType("action.failed");
    }
  }, [tweaks.state]);

  // If any narrowing param is set, scope is forced to "custom"
  // (mirrors backend behaviour from spec).
  const narrowingActive = !!(eventType || actorType || dateRange.after || dateRange.before || entitySel.entityType || entitySel.entityId);
  const effectiveScope = narrowingActive ? "custom" : scope;

  // ── Apply filters in-memory ──────────────────────────────────────────
  const allRows = data.rows;

  const filteredRows = useMemoA(() => {
    if (tweaks.state === "empty-zero") return [];

    let out = allRows;

    // scope
    if (effectiveScope === "operational") {
      out = out.filter(r => r._inOperational);
    }
    if (effectiveScope === "custom") {
      // custom doesn't auto-include all; the narrowing params do their own work,
      // but the chip that *was* active before custom remains the implicit base.
      // For UI simplicity: if user had "operational" selected before narrowing,
      // we still respect the operational base unless they toggled to "all".
      if (scope === "operational") out = out.filter(r => r._inOperational);
    }

    // narrowing
    if (eventType) out = out.filter(r => r.eventType === eventType);
    if (actorType) out = out.filter(r => r.actorType === actorType);
    if (dateRange.after) {
      const t = new Date(dateRange.after).getTime();
      out = out.filter(r => new Date(r.timestamp).getTime() >= t);
    }
    if (dateRange.before) {
      const t = new Date(dateRange.before).getTime() + 24*60*60*1000;
      out = out.filter(r => new Date(r.timestamp).getTime() < t);
    }
    if (entitySel.entityType) out = out.filter(r => r.entityType === entitySel.entityType);
    if (entitySel.entityId) {
      const q = entitySel.entityId.toLowerCase();
      out = out.filter(r => r.entityId.toLowerCase().includes(q));
    }
    return out;
  }, [allRows, effectiveScope, scope, eventType, actorType, dateRange, entitySel, tweaks.state]);

  // ── Counts for chip subtitles ─────────────────────────────────────────
  const counts = useMemoA(() => {
    const all = allRows.length;
    const operational = allRows.filter(r => r._inOperational).length;
    const byActor = { user: 0, agent: 0, system: 0, service_account: 0 };
    allRows.forEach(r => { byActor[r.actorType] = (byActor[r.actorType] || 0) + 1; });
    const byEvent = {};
    allRows.forEach(r => { byEvent[r.eventType] = (byEvent[r.eventType] || 0) + 1; });
    return { all, operational, byActor, byEvent };
  }, [allRows]);

  // Unique entityTypes for selector
  const entityTypes = useMemoA(() => {
    return Array.from(new Set(allRows.map(r => r.entityType))).sort();
  }, [allRows]);

  // Row toggling
  function toggleRow(id){
    setExpandedId(cur => cur === id ? null : id);
  }
  function scrollAndTarget(id){
    setExpandedId(id);
    setTargetId(id);
    setTimeout(() => {
      const el = document.querySelector(`[data-rowid="${id}"]`);
      // soft fallback — the table component handles scroll via ref
    }, 0);
    setTimeout(() => setTargetId(null), 1700);
  }

  function clearFilters(){
    setEventType(null);
    setActorType(null);
    setDateRange({ after: null, before: null });
    setEntitySel({ entityType: null, entityId: null });
    // Keep scope at the operator's last manual choice (operational or all).
    if (tweaks.state === "empty-filtered") setTweak("state", "normal");
  }

  function refresh(){
    setRefreshing(true);
    setTimeout(() => {
      setFetchedAt(Date.now());
      setRefreshing(false);
    }, 700);
  }

  // ── Render ──────────────────────────────────────────────────────────
  const loading = !!tweaks.loading;
  const errorMode = !!tweaks.errorMode;
  const showEmptyZero = filteredRows.length === 0 && !narrowingActive && scope === "operational" && (tweaks.state === "empty-zero");
  const showEmptyFiltered = filteredRows.length === 0 && !showEmptyZero;
  const visibleHasContent = filteredRows.length > 0;
  const fetchedAgo = Math.max(0, Math.floor((now - fetchedAt) / 60_000));

  return (
    <div className="activity">
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
            <span className="brand-page">Activity</span>
          </div>
          <div className="topbar-right">
            <span className="live-pip">audit ledger</span>
            <span>SGT &middot; {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="topbar-user">
              <span className="me">{data.currentUser.initials}</span>
              <span>{data.currentUser.display}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Page head */}
      <div className="page-head">
        <div className="lead">
          <span className="eyebrow">Mercury Tools &middot; /activity</span>
          <h1 className="page-title">
            The org's complete <span className="accent">memory.</span>
          </h1>
          <p className="page-sub">
            Every mutation by every actor &mdash; user, agent, service account, system &mdash; lands here, hash-chained.
            Forty-five event types, scoped to the sixteen that map to operator-visible actions by default. Use the rail
            to narrow; the chain stays intact.
          </p>
        </div>
        <div className="page-meta">
          <div className="stat-tile">
            <span className="eyebrow">entries shown</span>
            <span className="v" data-tabular>{filteredRows.length}</span>
            <span className="sub">of {effectiveScope === "all" ? counts.all : counts.operational} on this page</span>
          </div>
          <div className="stat-tile accent">
            <span className="eyebrow">scope</span>
            <span className="v" style={{fontSize:"15px", textTransform:"uppercase", letterSpacing:"0.14em", paddingTop:"6px"}}>{effectiveScope}</span>
            <span className="sub">{effectiveScope === "custom" ? "narrowing params present" : effectiveScope === "operational" ? "16-event allowlist" : "all 45 event types"}</span>
          </div>
          <div className="stat-tile">
            <span className="eyebrow">last ledger entry</span>
            <span className="v" style={{fontSize:"15px", paddingTop:"6px"}}>{window.fmtRel(VIEW_NOW - new Date(data.ledgerLastEntryAt).getTime() + (now - fetchedAt))}</span>
            <span className="sub">chain head &middot; verified</span>
          </div>
        </div>
      </div>

      {/* Filter strip */}
      <div className="filterstrip">
        <div className="filterstrip-row">
          <span className="eyebrow">scope</span>
          <div className="scope-seg" role="group" aria-label="Activity scope">
            <button
              className={effectiveScope === "operational" ? "on" : ""}
              onClick={() => { setScope("operational"); }}
            >
              Operational <span className="ct">{counts.operational}</span>
            </button>
            <button
              className={effectiveScope === "all" ? "on" : ""}
              onClick={() => { setScope("all"); }}
            >
              All <span className="ct">{counts.all}</span>
            </button>
            <button
              className={effectiveScope === "custom" ? "on" : ""}
              onClick={() => { /* custom is auto-derived */ }}
              title={narrowingActive ? "custom is automatic when narrowing params are set" : "set a filter below to enable custom"}
            >
              Custom {narrowingActive && <span className="custom-mark" />}
            </button>
          </div>

          <span className="eyebrow">event</span>
          <EventTypeCombo
            value={eventType}
            onChange={setEventType}
            bands={data.eventTypes}
            counts={counts.byEvent}
          />

          <span className="eyebrow">actor</span>
          <div className="actor-group" role="group" aria-label="Actor type">
            {["user", "agent", "system", "service_account"].map(at => (
              <button
                key={at}
                className={"actor-pill" + (actorType === at ? " on" : "")}
                onClick={() => setActorType(actorType === at ? null : at)}
              >
                {window.ACTOR_LABEL[at]} <span className="ct">{counts.byActor[at] || 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filterstrip-row" style={{paddingTop: 0}}>
          <span className="eyebrow">range</span>
          <DateRange after={dateRange.after} before={dateRange.before} onChange={setDateRange} />

          <span className="eyebrow">entity</span>
          <EntitySelector
            entityType={entitySel.entityType}
            entityId={entitySel.entityId}
            types={entityTypes}
            onChange={setEntitySel}
          />

          <span className="filter-spacer" />

          <span className="filter-meta">
            <span>limit</span><b>50</b>
            <span style={{opacity:0.5, margin:"0 4px"}}>·</span>
            <span>cursor</span><b>head</b>
          </span>

          {narrowingActive && (
            <button className="filter-clear" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      </div>

      {/* Error banner — does NOT unmount the table */}
      {errorMode && (
        <div className="errbanner">
          <span className="eyebrow">request failed</span>
          <span className="msg">
            GET /api/dashboard/activity returned 503 after 8s. The previous page of entries is still shown below; nothing was dropped.
          </span>
          <button className="retry" onClick={() => setTweak("errorMode", false)}>Retry</button>
        </div>
      )}

      {/* Table / states */}
      {loading ? (
        <SkeletonTable />
      ) : showEmptyZero ? (
        <div className="empty">
          <span className="eyebrow">ledger health</span>
          <div className="qmark">No activity <em>recorded yet</em>.</div>
          <div className="qsub">
            The chain is healthy and the writer is connected &mdash; no audit-emitting event has fired in this org's window. Once an agent proposes a mutation or an operator changes a policy, entries will appear here, hash-chained to the genesis row.
          </div>
          <div className="qmeta">
            <span className="eyebrow">last recorded</span>
            <b>{new Date(data.ledgerLastEntryAt).toLocaleString()}</b>
            <span style={{opacity:0.5}}>·</span>
            <span>chain head verified</span>
          </div>
        </div>
      ) : showEmptyFiltered ? (
        <div className="empty">
          <span className="eyebrow">no matches</span>
          <div className="qmark">No entries match <em>these filters</em>.</div>
          <div className="qsub">
            We checked {effectiveScope === "all" ? counts.all : counts.operational} entries across the current scope. Try broadening the date range, dropping the entity, or switching to <b style={{color:"var(--ink-2)"}}>All events</b> if you're looking for non-operational types like <span style={{fontFamily:"var(--font-mono)"}}>event.published</span>.
          </div>
          <button className="cta" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <ActivityTable
          rows={filteredRows}
          expandedId={expandedId}
          onToggle={toggleRow}
          now={VIEW_NOW}
          targetId={targetId}
        />
      )}

      {/* Pagination — keyset (no total) */}
      {visibleHasContent && !loading && (
        <div className="pag">
          <span className="info">
            Showing <b>{filteredRows.length}</b> of <b>…</b>
            <span className="sep">·</span>
            keyset cursor — total unknown by design
            <span className="sep">·</span>
            limit <b>50</b>
          </span>
          <div className="nav">
            <button disabled title="no newer cursor on stack">← Newer</button>
            <button disabled={filteredRows.length < 30} title={filteredRows.length < 30 ? "current page fits in one keyset window" : "advance"}>Older →</button>
          </div>
        </div>
      )}

      {/* Stale pill */}
      {tweaks.showStalePill && !loading && (
        <div className="stale-pill">
          <span>fetched</span>
          <span className="age">{fetchedAgo === 0 ? "just now" : `${fetchedAgo}m ago`}</span>
          <button className={"refresh" + (refreshing ? " spinning" : "")} onClick={refresh}>
            {refreshing ? "fetching…" : "refresh"}
          </button>
        </div>
      )}

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Scenario" />
        <TweakSelect
          label="Page state"
          value={tweaks.state}
          options={[
            { value: "normal", label: "Normal — Operational scope" },
            { value: "all-events", label: "All events scope (shows event.published)" },
            { value: "filter-action-failed", label: "Narrowed — action.failed only" },
            { value: "expanded-critical", label: "Critical entry expanded" },
            { value: "empty-filtered", label: "Empty — filters return zero" },
            { value: "empty-zero", label: "Empty — ledger has no entries" },
          ]}
          onChange={v => setTweak("state", v)}
        />

        <TweakSection label="System states" />
        <TweakToggle label="Loading skeleton" value={!!tweaks.loading} onChange={v => setTweak("loading", v)} />
        <TweakToggle label="Network error banner" value={!!tweaks.errorMode} onChange={v => setTweak("errorMode", v)} />
        <TweakToggle label="Stale-fetch pill (bottom-right)" value={!!tweaks.showStalePill} onChange={v => setTweak("showStalePill", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<ActivityApp />);
