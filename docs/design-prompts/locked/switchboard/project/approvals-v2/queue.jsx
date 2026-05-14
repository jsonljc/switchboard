/* /approvals — queue list (left pane) */
const { useState: useStateQ, useEffect: useEffectQ } = React;

// Format ms → "Xm Ys" / "Xh Ym" / "expired"
function fmtRemaining(ms){
  if (ms <= 0) return "expired";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ${m % 60}m`;
  if (m >= 1) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function fmtAgo(ms){
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return `${s}s ago`;
}
function timerLevel(ms){
  if (ms <= 0) return "expired";
  if (ms < 5 * 60 * 1000) return "critical";
  if (ms < 60 * 60 * 1000) return "warn";
  return "";
}

// Risk pip counts (no traffic colors — depth via "on" count)
const RISK_PIPS = { low: 1, medium: 2, high: 3, critical: 4 };

function RiskPips({ risk }){
  const on = RISK_PIPS[risk] || 0;
  return (
    <div className="qrow-pips" aria-hidden="true">
      {[0,1,2,3].map(i => (
        <span key={i} className={"qrow-pip" + (i < on ? " on" : "")} />
      ))}
    </div>
  );
}

function QueueRow({ req, active, onSelect, now }){
  const remaining = req.expiresAt - now;
  const tlevel = timerLevel(remaining);
  const quorumNeeded = (req.request && req.request.approvalsRequired) || 1;
  const quorumSigned = (req.state && req.state.approvalHashes && req.state.approvalHashes.length) || 0;
  const hasQuorum = quorumNeeded > 1;
  const quorumComplete = quorumSigned >= quorumNeeded;
  const recovery = req.status === "recovery_required";

  return (
    <button
      className={"qrow" + (active ? " active" : "")}
      data-risk={req.riskCategory}
      data-status={req.status}
      onClick={() => onSelect(req.id)}
    >
      <span className="qrow-edge" />
      <span className="qrow-active-mark" />

      <div className="qrow-risk">
        <span>{req.riskCategory}</span>
        <RiskPips risk={req.riskCategory} />
      </div>

      <div className="qrow-body">
        <div className="qrow-summary">{req.summary}</div>
        <div className="qrow-meta">
          <span>
            <span className="eyebrow" style={{fontSize:"10px",marginRight:"4px"}}>expires</span>
            <b>{fmtRemaining(remaining)}</b>
          </span>
          <span className="sep">·</span>
          <span>created {fmtAgo(now - req.createdAt)}</span>
          <span className="sep">·</span>
          <span className="agent">{req.agent}</span>
          {hasQuorum && (
            <>
              <span className="sep">·</span>
              <span className={"qrow-quorum" + (quorumComplete ? " complete" : "")}>
                {quorumSigned} of {quorumNeeded}
              </span>
            </>
          )}
          {recovery && (
            <>
              <span className="sep">·</span>
              <span className="qrow-recover-tag">recovery</span>
            </>
          )}
        </div>
      </div>

      <div className="qrow-right">
        <span className={"qrow-timer " + tlevel}>{fmtRemaining(remaining)}</span>
        <span className="qrow-id">{req.id}</span>
      </div>
    </button>
  );
}

function SkeletonRow(){
  return (
    <div className="qrow-skel">
      <div className="skel-bar short" />
      <div className="skel-bar lng" />
      <div className="skel-bar med" />
    </div>
  );
}

function Queue({ items, activeId, onSelect, loading, now }){
  if (loading) {
    return (
      <div className="queue">
        {Array.from({length: 6}).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="queue">
        <div className="queue-empty">
          <div className="eyebrow">queue clear</div>
          <div className="qmark">Nothing waiting.</div>
          <div className="qsub">When an agent proposes a mutating action that needs your sign-off, it'll appear here with full evidence and a binding hash.</div>
          <div className="qmeta">
            <span className="eyebrow">last cleared</span> <b>{window.APPROVALS_LAST_CLEARED || "13m ago"}</b>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="queue">
      {items.map(r => (
        <QueueRow
          key={r.id}
          req={r}
          active={r.id === activeId}
          onSelect={onSelect}
          now={now}
        />
      ))}
    </div>
  );
}

window.Queue = Queue;
window.fmtRemaining = fmtRemaining;
window.fmtAgo = fmtAgo;
window.timerLevel = timerLevel;
