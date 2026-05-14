/* /activity — table rows + inline drawer */
const { useState: useStateT, useMemo: useMemoT, useRef: useRefT } = React;

// ── time formatters ────────────────────────────────────────────────────────
function fmtClock(ts){
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
function fmtRel(ms){
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return `${s}s ago`;
}
function fmtFullISO(ts){
  const d = new Date(ts);
  const pad = (n, w=2) => String(n).padStart(w, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
  // local TZ offset
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off)/60));
  const om = pad(Math.abs(off) % 60);
  return { date, time, tz: `${sign}${oh}:${om}` };
}

// ── event-type → band, for the dot color ──────────────────────────────────
function eventBand(evt){
  if (evt.startsWith("action.")) return "action";
  if (evt.startsWith("agent.") || evt.startsWith("work_trace.")) return "agent";
  if (evt.startsWith("event.")) return "event";
  return "identity";
}

// ── actor → 3-letter glyph ────────────────────────────────────────────────
const ACTOR_GLYPH = {
  user: "USR",
  agent: "AGT",
  system: "SYS",
  service_account: "SVC",
};
const ACTOR_LABEL = {
  user: "User",
  agent: "Agent",
  system: "System",
  service_account: "Service",
};

// ── Copy-to-clipboard hook ────────────────────────────────────────────────
function useCopier(){
  const [copied, setCopied] = useStateT(null);
  function copy(key, text){
    try {
      navigator.clipboard.writeText(text);
    } catch(e) { /* ignore */ }
    setCopied(key);
    setTimeout(() => setCopied(c => c === key ? null : c), 1100);
  }
  return [copied, copy];
}

// ============================================================================
// Inline drawer
// ============================================================================
function Drawer({ row, allRows, onScrollToRow }){
  const [copied, copy] = useCopier();
  const iso = fmtFullISO(row.timestamp);

  // chain neighbor (older row whose entryHash === this row's previousEntryHash)
  const prevRow = useMemoT(() => {
    if (!row.previousEntryHash) return null;
    return allRows.find(r => r.entryHash === row.previousEntryHash) || null;
  }, [row, allRows]);

  return (
    <div className="drawer" role="region" aria-label="Audit entry detail">
      <div className="drawer-inner">

        {/* Timestamp — full ISO */}
        <div className="dsection">
          <span className="label">Timestamp</span>
          <span className="full-iso">
            {iso.date} <span className="tz">·</span> {iso.time} <span className="tz">{iso.tz}</span>
          </span>
          <span className="snap-note">
            stored as ISO-8601 UTC on the entry; rendered in your browser's local timezone.
          </span>
        </div>

        {/* Visibility */}
        <div className="dsection">
          <span className="label">Visibility &middot; classification</span>
          <span className="full-iso">
            visibility:&nbsp;<b style={{fontWeight:600}}>{row.visibilityLevel}</b>
            &nbsp;<span className="tz">·</span>&nbsp;
            risk:&nbsp;<b style={{fontWeight:600}}>{row.riskCategory}</b>
            &nbsp;<span className="tz">·</span>&nbsp;
            event:&nbsp;<b style={{fontWeight:600}}>{row.eventType}</b>
          </span>
          <span className="snap-note">
            visibilityLevel is server-filtered; the client only ever sees rows it's authorized to read.
          </span>
        </div>

        {/* Snapshot keys — allowlisted only */}
        <div className="dsection full">
          <span className="label">Snapshot keys <span style={{opacity:0.55, fontWeight:600}}>(allowlist · values redacted)</span></span>
          <div className="snap-keys">
            {row.snapshotKeys.length === 0 ? (
              <span className="evnone">no snapshot keys recorded</span>
            ) : (
              row.snapshotKeys.map(k => <span key={k} className="snap-key">{k}</span>)
            )}
            {row.redactedKeyCount > 0 && (
              <span className="snap-redacted">+{row.redactedKeyCount} redacted</span>
            )}
          </div>
          <span className="snap-note">
            Full snapshot values stay on the server. Only allowlisted key <em>names</em> appear here
            ({" "}<span style={{fontFamily:"var(--font-mono)", fontStyle:"normal"}}>id, kind, source, actionType, decisionId, recommendationId, approvalId, envelopeId, agentKey, targetEntityType, targetEntityId, correlationId, traceId</span>{" "});
            everything else is rolled into the redacted count.
          </span>
        </div>

        {/* Evidence — hash + prefix, copy buttons */}
        <div className="dsection full">
          <span className="label">Evidence pointers</span>
          {row.evidencePointers.length === 0 ? (
            <span className="evnone">no evidence pointers attached</span>
          ) : (
            <div className="evlist">
              {row.evidencePointers.map((e, i) => (
                <div key={i} className="evrow">
                  <span className="evtype">{e.type}</span>
                  <span className="evhash" title={e.hash}>
                    <span className="prefix">{e.hashPrefix}</span>
                    <span className="rest">{e.hash.slice(16)}</span>
                  </span>
                  <button
                    className={"copybtn" + (copied === "ev"+i ? " copied" : "")}
                    onClick={(ev) => { ev.stopPropagation(); copy("ev"+i, e.hash); }}
                  >
                    {copied === "ev"+i ? "copied" : "copy hash"}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="absence-note">
            <b>storageRef</b> intentionally absent — evidence reference is held server-side.
            Surface the absence, not a redacted placeholder; clients fetch evidence via
            authenticated <span style={{color:"var(--ink-2)"}}>/api/evidence/:hash</span>.
          </div>
        </div>

        {/* Hash chain */}
        <div className="dsection full">
          <span className="label">Hash chain &middot; integrity anchor</span>
          <div className="chain">
            <div className="chain-row">
              <span className="label">Entry hash</span>
              <span className="hash">{row.entryHash}</span>
              <span className="actions">
                <button
                  className={"copybtn" + (copied === "eh" ? " copied" : "")}
                  onClick={(ev) => { ev.stopPropagation(); copy("eh", row.entryHash); }}
                >{copied === "eh" ? "copied" : "copy"}</button>
              </span>
            </div>
            <div className={"chain-row" + (prevRow ? "" : " anchor")}>
              <span className="label">Previous</span>
              <span className="hash">
                {row.previousEntryHash || "— genesis (no predecessor) —"}
              </span>
              <span className="actions">
                {row.previousEntryHash && (
                  <>
                    <button
                      className={"copybtn" + (copied === "ph" ? " copied" : "")}
                      onClick={(ev) => { ev.stopPropagation(); copy("ph", row.previousEntryHash); }}
                    >{copied === "ph" ? "copied" : "copy"}</button>
                    {prevRow ? (
                      <button
                        className="copybtn"
                        style={{color:"var(--ink)", borderColor:"var(--ink)"}}
                        onClick={(ev) => { ev.stopPropagation(); onScrollToRow(prevRow.id); }}
                      >view previous ↓</button>
                    ) : (
                      <span className="evnone" style={{fontSize:11}}>off-page</span>
                    )}
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Envelope + trace */}
        <div className="dsection full">
          <span className="label">References</span>
          <div className="linkpair">
            <div className={"linkrow" + (row.envelopeId ? "" : " empty")}>
              <span className="label">Envelope</span>
              <span className="val">{row.envelopeId || "no approval envelope"}</span>
              {row.envelopeId && (
                <>
                  <button
                    className={"copybtn" + (copied === "env" ? " copied" : "")}
                    onClick={(ev) => { ev.stopPropagation(); copy("env", row.envelopeId); }}
                  >{copied === "env" ? "copied" : "copy"}</button>
                  <a className="openlink" href={`/approvals/${row.envelopeId}`} onClick={ev=>ev.stopPropagation()}>
                    open ↗
                  </a>
                </>
              )}
            </div>
            <div className={"linkrow" + (row.traceId ? "" : " empty")}>
              <span className="label">Trace</span>
              <span className="val">{row.traceId || "no correlation trace"}</span>
              {row.traceId && (
                <>
                  <button
                    className={"copybtn" + (copied === "tr" ? " copied" : "")}
                    onClick={(ev) => { ev.stopPropagation(); copy("tr", row.traceId); }}
                  >{copied === "tr" ? "copied" : "copy"}</button>
                  <a className="openlink" href={`/traces/${row.traceId}`} onClick={ev=>ev.stopPropagation()}>
                    open ↗
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ============================================================================
// Row + drawer host
// ============================================================================
function ActivityRow({ row, allRows, isOpen, isTarget, onToggle, onScrollToRow, rowRef, now }){
  const ts = new Date(row.timestamp).getTime();
  const band = eventBand(row.eventType);
  const glyph = ACTOR_GLYPH[row.actorType] || "—";
  return (
    <React.Fragment>
      <div
        ref={rowRef}
        className={"arow" + (isOpen ? " open" : "") + (isTarget ? " target" : "")}
        data-risk={row.riskCategory}
        onClick={() => onToggle(row.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(row.id); } }}
      >
        <div className="col-time">
          <span className="t">{fmtClock(row.timestamp)}</span>
          <span className="rel">{fmtRel(now - ts)}</span>
        </div>

        <div className="col-event">
          <span className="evt-badge" data-band={band}>
            <span className="evt-band" />
            <span className="evt-text">{row.eventType}</span>
          </span>
        </div>

        <div className="col-actor">
          <span className="actor-glyph" data-actor={row.actorType} title={ACTOR_LABEL[row.actorType]}>{glyph}</span>
          <span className="id" title={row.actorId}>{row.actorId}</span>
        </div>

        <div className="col-entity">
          <span className="et">{row.entityType}</span>
          <span className="eid" title={row.entityId}>{row.entityId}</span>
        </div>

        <div className="col-summary" title={row.summary}>
          {row.summary}
          {row.redactedKeyCount > 0 && (
            <span className="redacted-badge">+{row.redactedKeyCount} redacted</span>
          )}
        </div>

        <span className="chev">›</span>
      </div>
      {isOpen && (
        <Drawer row={row} allRows={allRows} onScrollToRow={onScrollToRow} />
      )}
    </React.Fragment>
  );
}

// ============================================================================
// Table
// ============================================================================
function ActivityTable({ rows, expandedId, onToggle, now, targetId }){
  const rowRefs = useRefT({});

  function scrollToRow(id){
    const el = rowRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="table-wrap">
      <div className="table-head">
        <span className="col">Time</span>
        <span className="col">Event</span>
        <span className="col">Actor</span>
        <span className="col">Entity</span>
        <span className="col">Summary</span>
        <span className="col" style={{textAlign:"right"}}>·</span>
      </div>
      {rows.map(r => (
        <ActivityRow
          key={r.id}
          row={r}
          allRows={rows}
          isOpen={expandedId === r.id}
          isTarget={targetId === r.id}
          onToggle={onToggle}
          onScrollToRow={scrollToRow}
          rowRef={(el) => { rowRefs.current[r.id] = el; }}
          now={now}
        />
      ))}
    </div>
  );
}

function SkeletonTable(){
  return (
    <div className="table-wrap">
      <div className="table-head">
        <span className="col">Time</span>
        <span className="col">Event</span>
        <span className="col">Actor</span>
        <span className="col">Entity</span>
        <span className="col">Summary</span>
        <span className="col">·</span>
      </div>
      {Array.from({length: 10}).map((_, i) => (
        <div key={i} className="skel-row">
          <div className="skel-bar short" />
          <div className="skel-bar med" />
          <div className="skel-bar short" />
          <div className="skel-bar med" />
          <div className="skel-bar lng" />
          <div />
        </div>
      ))}
    </div>
  );
}

window.ActivityTable = ActivityTable;
window.SkeletonTable = SkeletonTable;
window.fmtRel = fmtRel;
window.fmtClock = fmtClock;
window.eventBand = eventBand;
window.ACTOR_GLYPH = ACTOR_GLYPH;
window.ACTOR_LABEL = ACTOR_LABEL;
