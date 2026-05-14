// /mission — operator's cross-agent command center.
// Three zones: Now (Zone A) · Queue + Agents (Zone B) · Context strip (Zone C).
// Doctrine: queue is the headline. Numbers support; never lead.

const D = window.MISSION_DATA;

// ── Topbar (matches /approvals, /activity, /reports) ──────────────
function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand-cluster">
          <span className="brand-mark">
            <Mark />
            Switchboard
          </span>
          <span className="brand-sep">/</span>
          <span className="brand-org">Lumera Aesthetics · Singapore</span>
          <span className="brand-sep">·</span>
          <span className="brand-page">mission</span>
        </div>
        <div className="topbar-right">
          <nav className="topbar-nav">
            <a href="#">/approvals</a>
            <a href="#">/pipeline</a>
            <a href="#">/reports</a>
            <a href="#">/activity</a>
          </nav>
          <span className="topbar-user">
            <span className="me">J</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1.5" y="1.5" width="19" height="19" rx="3" fill="#1A1714" />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path d="M 7 11 Q 11 6.5, 15 11" stroke="#A07850" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ── ZONE A — Now ──────────────────────────────────────────────────
function ZoneNow({ onJumpQueue }) {
  const g = D.greeting;
  const p = D.pulse;
  const delta = p.newInquiriesToday - p.newInquiriesYesterday;
  const deltaStr = (delta >= 0 ? '+' : '') + delta;
  const [haltOpen, setHaltOpen] = React.useState(false);
  return (
    <section className="zone-now" data-screen-label="Mission / Now">
      <div className="lead">
        <span className="eyebrow">Good {g.period} · {g.fetchedAtIso}</span>
        <h1 className="greeting">
          Good {g.period}, <span className="accent">{g.operatorName}</span><span className="punct">.</span>
        </h1>
        <div className="pulse" data-tabular>
          <span className="pulse-cell">
            <span className={'v ' + (p.pendingApprovals > 0 ? 'warn' : 'zero')}>{p.pendingApprovals}</span>
            <span className="lbl">approvals waiting</span>
          </span>
          <span className="pulse-sep">·</span>
          <span className="pulse-cell">
            <span className={'v ' + (p.overdueTasks > 0 ? 'warn' : 'zero')}>{p.overdueTasks}</span>
            <span className="lbl">overdue tasks</span>
          </span>
          <span className="pulse-sep">·</span>
          <span className="pulse-cell">
            <span className="v">{p.newInquiriesToday}</span>
            <span className="lbl">new inquiries today</span>
            <span className="delta">(<b>{deltaStr}</b> vs yesterday)</span>
          </span>
          <span className="pulse-sep">·</span>
          <span className="pulse-cell">
            <span className="v">{p.bookingsToday}</span>
            <span className="lbl">bookings on the books</span>
          </span>
        </div>
      </div>

      <div className="haltmenu" onMouseLeave={() => setHaltOpen(false)}>
        <span className="lbl">Emergency</span>
        <button className="haltbtn" onClick={() => setHaltOpen(o => !o)}>
          Halt agent…
        </button>
        {haltOpen && <HaltPop onClose={() => setHaltOpen(false)} />}
      </div>
    </section>
  );
}

function HaltPop({ onClose }) {
  const [confirming, setConfirming] = React.useState(null); // agent id
  return (
    <div className="haltpop" role="dialog" aria-label="Emergency halt">
      <div className="hp-head">Stop an agent — <em style={{ fontStyle: 'italic', color: 'var(--amber-deep)' }}>requires confirmation</em></div>
      <div className="hp-sub">Halts the agent immediately; in-flight messages are cancelled. You can resume from the agent's home.</div>
      <div className="hp-list">
        {D.agents.map(a => (
          <div className="hp-row" key={a.id}>
            <span className="nm">{a.displayName}</span>
            <span className="st">{a.activityStatus}</span>
            {confirming === a.id ? (
              <button className="ac" style={{ background: 'var(--ink)', color: 'var(--paper)' }}
                      onClick={() => { setConfirming(null); onClose && onClose(); }}>
                Confirm halt
              </button>
            ) : (
              <button className="ac" onClick={() => setConfirming(a.id)}>Halt</button>
            )}
          </div>
        ))}
      </div>
      <div className="hp-foot">POST /api/agents/&lt;deployment&gt;/halt · audited</div>
    </div>
  );
}

// ── ZONE B — Queue ────────────────────────────────────────────────
const QUEUE_FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'approval',  label: 'Approvals' },
  { id: 'task',      label: 'Tasks' },
  { id: 'rec',       label: 'Recs' },
];

function ZoneQueue() {
  const [filter, setFilter] = React.useState('all');
  const [expanded, setExpanded] = React.useState(null); // queue id

  const items = D.queue.filter(q => filter === 'all' ? true : q.kind === filter);
  const counts = {
    all: D.queue.length,
    approval: D.queue.filter(q => q.kind === 'approval').length,
    task: D.queue.filter(q => q.kind === 'task').length,
    rec: D.queue.filter(q => q.kind === 'rec').length,
  };

  return (
    <section className="zone-queue" data-screen-label="Mission / Queue + Agents">
      <div className="queue-col">
        <div className="queue-head">
          <div className="lead">
            <h2 className="ttl">The <em>queue</em></h2>
            <span className="ct"><b data-tabular>{items.length}</b> items · sorted by urgency</span>
          </div>
          <div className="queue-filters">
            {QUEUE_FILTERS.map(f => (
              <button key={f.id}
                      className={'qfchip' + (filter === f.id ? ' on' : '')}
                      onClick={() => setFilter(f.id)}>
                {f.label}
                <span className="ct" data-tabular>{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="qlist">
          {items.length === 0 ? (
            <div className="qempty">
              <div className="qmark"><em>Inbox zero.</em> Nothing needs you right now.</div>
              <div className="qsub">Alex, Riley and Mira are running inside the rails you set. They'll surface here the moment something falls outside them.</div>
              <div className="qmeta">Last cleared <b>08:14 SGT</b> · 28m ago</div>
            </div>
          ) : items.map(q => (
            <QueueCard key={q.id} q={q}
              expanded={expanded === q.id}
              onToggle={() => setExpanded(e => e === q.id ? null : q.id)} />
          ))}
        </div>
      </div>

      <AgentsCol />
    </section>
  );
}

function QueueCard({ q, expanded, onToggle }) {
  const KIND_LABEL = { approval: 'Approval', task: 'Task', rec: 'Rec' };
  const riskPipCount = { low: 1, medium: 2, high: 3, critical: 4 }[q.risk] || 1;
  return (
    <div className={'qcard' + (expanded ? ' expanded' : '')}
         data-risk={q.risk}
         data-overdue={q.overdue ? 'true' : 'false'}
         onClick={onToggle}
         data-comment-anchor={'queue/' + q.id}>
      <span className="qcard-edge" />

      <div className="qcard-typecol">
        <span className="qchip" data-kind={q.kind}>{KIND_LABEL[q.kind]}</span>
        <span className="qcard-risk">
          {q.risk}
          <span className="qcard-risk-pips">
            {[0,1,2,3].map(i => (
              <span key={i} className={'qcard-risk-pip' + (i < riskPipCount ? ' on' : '')} />
            ))}
          </span>
        </span>
      </div>

      <div className="qcard-body">
        <div className="qcard-summary">{q.summary}</div>
        <div className="qcard-meta">
          {q.agent && <span className="agent" data-agent={q.agent}>{q.agent}</span>}
          {q.agent && <span className="sep">·</span>}
          {q.campaign && <React.Fragment><span className="campaign">{q.campaign}</span><span className="sep">·</span></React.Fragment>}
          {q.hashShort && <React.Fragment><span className="hash">{q.hashShort}</span><span className="sep">·</span></React.Fragment>}
          <span>{q.ageLabel}</span>
        </div>
      </div>

      <div className="qcard-right">
        <span className={'qcard-timer ' + (q.expiryState || '')}>
          {q.overdue ? 'overdue' : q.expiryLabel}
        </span>
        {q.kind === 'approval' && (
          <button className="qcard-actbtn primary"
                  onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {expanded ? 'Collapse' : q.primary}
          </button>
        )}
        {q.kind === 'task' && (
          <button className="qcard-actbtn"
                  onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {q.primary}
          </button>
        )}
        {q.kind === 'rec' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="qcard-actbtn ghost" onClick={(e) => e.stopPropagation()}>Dismiss</button>
            <button className="qcard-actbtn"     onClick={(e) => e.stopPropagation()}>Accept</button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="qdraw">
          <div className="detail">{q.detail}</div>
          {q.kind === 'approval' && q.hashShort && (
            <div className="hashrow">
              <span className="eyebrow" style={{ color: 'var(--ink-2)', letterSpacing: '0.16em' }}>Binding hash</span>
              <span className="hash">{q.hashShort}</span>
              <span>· environment <b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>prod-sg</b> · quorum 1 of 2</span>
            </div>
          )}
          {q.kind === 'approval' && (
            <label className="ack" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" />
              <span>I confirm hash <span className="ch">{(q.hashShort || '').split('·')[1] || '7k4m'}</span> · this will be cryptographically signed and posted to the audit feed.</span>
            </label>
          )}
          <div className="row">
            {q.kind === 'approval' && (
              <React.Fragment>
                <button className="qcard-actbtn primary" onClick={(e) => e.stopPropagation()}>
                  Approve · sign hash
                </button>
                <button className="qcard-actbtn ghost" onClick={(e) => e.stopPropagation()}>Patch & resubmit</button>
                <button className="qcard-actbtn ghost" onClick={(e) => e.stopPropagation()}>Reject</button>
              </React.Fragment>
            )}
            {q.kind === 'task' && (
              <React.Fragment>
                <button className="qcard-actbtn primary" onClick={(e) => e.stopPropagation()}>Mark done</button>
                <button className="qcard-actbtn ghost" onClick={(e) => e.stopPropagation()}>Snooze 1h</button>
                <button className="qcard-actbtn ghost" onClick={(e) => e.stopPropagation()}>Reassign</button>
              </React.Fragment>
            )}
            {q.kind === 'rec' && (
              <React.Fragment>
                <button className="qcard-actbtn primary" onClick={(e) => e.stopPropagation()}>Accept · undo within 6h</button>
                <button className="qcard-actbtn ghost" onClick={(e) => e.stopPropagation()}>Dismiss</button>
              </React.Fragment>
            )}
            <span className="spacer" />
            <a className="openlink" href="#" onClick={(e) => e.stopPropagation()}>Open full record</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agents column ─────────────────────────────────────────────────
function AgentsCol() {
  return (
    <aside className="agents-col">
      <div className="agents-head">
        <span className="ttl">Agents</span>
        <span className="ct"><span data-tabular>{D.agents.length}</span> running · live</span>
      </div>
      <div className="agents-list">
        {D.agents.map(a => <AgentCard key={a.id} a={a} />)}
      </div>
    </aside>
  );
}

function AgentCard({ a }) {
  return (
    <div className="acard" data-halted={a.halted ? 'true' : 'false'}
         data-comment-anchor={'agent/' + a.id}>
      <div className="acard-head">
        <span className="acard-name">{a.displayName}</span>
        <span className="acard-status" data-status={a.activityStatus}>
          <span className="dot" />
          {a.activityStatus}
        </span>
      </div>
      <div className="acard-role">{a.role}</div>
      <div className="acard-task">{a.currentTask}</div>
      <div className="acard-last">
        <span className="summary">{a.lastActionSummary}</span>
        <span className="ago">{a.lastActionAt} ago</span>
      </div>
      <span className="acard-cta">Open /{a.id}</span>
    </div>
  );
}

// ── ZONE C — Context strip ────────────────────────────────────────
function ZoneContext() {
  const maxFunnel = Math.max(...D.funnel.map(f => f.count));
  return (
    <section className="zone-context" data-screen-label="Mission / Context strip">
      <div className="context-grid">
        {/* Funnel mini */}
        <div className="ccell">
          <div className="head">
            <span className="ttl">Funnel <em>this week</em></span>
            <a className="openlink" href="#">Open report →</a>
          </div>
          <div className="funnel">
            {D.funnel.map(f => (
              <div className="frow" key={f.key}>
                <span className="lbl">{f.label}</span>
                <span className="bar">
                  <span className="fill" style={{ width: ((f.count / maxFunnel) * 100) + '%' }} />
                </span>
                <span className="ct" data-tabular>{f.count}</span>
              </div>
            ))}
          </div>
          <div className="funnel-foot">
            <b>9%</b> inquiry → completed · <b>69%</b> qualified → booked
          </div>
        </div>

        {/* Revenue */}
        <div className="ccell">
          <div className="head">
            <span className="ttl">Revenue <em>{D.revenue.rangeLabel}</em></span>
            <a className="openlink" href="#">Open report →</a>
          </div>
          <div className="revenue">
            <div className="rev-big" data-tabular>{D.revenue.totalLabel}</div>
            <div className="rev-meta">
              <b data-tabular>{D.revenue.countLabel}</b> · top source <b>{D.revenue.topSource}</b>
            </div>
            <div className="rev-caption">
              Quiet morning. Friday's tour day usually pulls in 4–5 of these.
            </div>
          </div>
        </div>

        {/* Bookings today */}
        <div className="ccell">
          <div className="head">
            <span className="ttl">Bookings <em>today</em></span>
            <a className="openlink" href="#">Open pipeline →</a>
          </div>
          <div className="bookings">
            {D.bookings.slice(0, 4).map(b => (
              <div className="brow" key={b.id} data-status={b.status}>
                <span className="time" data-tabular>{b.startsAt}</span>
                <span className="who">
                  <span className="nm">{b.contactName}</span>
                  <span className="svc">{b.service}</span>
                </span>
                <span className="ch" data-ch={b.channel}>{b.channel}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Activity tail ─────────────────────────────────────────────────
function ActivityTail() {
  return (
    <section className="tail" data-screen-label="Mission / Activity tail">
      <div className="tail-head">
        <span className="ttl">Activity tail · <b data-tabular>last 8</b></span>
        <a className="openlink" href="#">Open /activity →</a>
      </div>
      <div className="tail-list">
        {D.activity.map((a, i) => (
          <div className="trow" key={i}>
            <span className="t">{a.time}</span>
            <span className="actor" data-actor={a.actor}>{a.actor}</span>
            <span className="who">{a.actorAgent || (a.actor === 'USR' ? 'Jason' : 'system')}</span>
            <span className="summary">{a.summary}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function FootCap() {
  return (
    <footer className="footcap">
      <span className="left">
        Fetched <b>{D.greeting.fetchedAt}</b> · auto-refresh off · manual refresh
      </span>
      <span className="right">
        <span>prod-sg · operator: Jason</span>
        <button className="refresh">Refresh now</button>
      </span>
    </footer>
  );
}

// ── App ───────────────────────────────────────────────────────────
function App() {
  return (
    <React.Fragment>
      <Topbar />
      <main>
        <ZoneNow />
        <ZoneQueue />
        <ZoneContext />
        <ActivityTail />
        <FootCap />
      </main>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
