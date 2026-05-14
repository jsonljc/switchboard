// Alex cockpit v3 — refined.
// Single column. ⌘K palette + structured-pending-action composer.
// Pixel avatar in a no-clip frame. Tappable mission subtitle.
// ROI bar with target + week-1 fallback. KPI collapses when approval present.
// Activity rows: persistent open state, longer thread preview, inline reply box.

const T = {
  bg: '#FAF8F2',
  paper: '#FFFFFF',
  ink: '#0E0C0A',
  ink2: '#3A332B',
  ink3: '#6B6052',
  ink4: '#A39786',
  ink5: '#C8BEAE',
  hair: 'rgba(14, 12, 10, 0.08)',
  hairSoft: 'rgba(14, 12, 10, 0.04)',
  amber: '#B8782E',
  amberDeep: '#7C4F1C',
  amberSoft: '#F1E2C2',
  amberPaper: '#FBF1D6',
  green: '#3F7A36',
  red: '#A03A2E',
  blue: '#3A5A80',
};

const KIND_META = {
  // Alex kinds
  booked:    { label: 'BOOKED',    color: T.amberDeep, bg: T.amberSoft },
  qualified: { label: 'QUALIFIED', color: T.amber,     bg: T.amberSoft },
  replied:   { label: 'REPLIED',   color: T.ink2,      bg: 'rgba(14,12,10,0.05)' },
  sent:      { label: 'SENT',      color: T.ink3,      bg: 'rgba(14,12,10,0.04)' },
  started:   { label: 'STARTED',   color: T.ink3,      bg: 'rgba(14,12,10,0.04)' },
  connected: { label: 'LEADS IN',  color: T.blue,      bg: 'rgba(58,90,128,0.08)' },
  waiting:   { label: 'WAITING',   color: T.amberDeep, bg: T.amberSoft },
  escalated: { label: 'TO YOU',    color: T.red,       bg: 'rgba(160,58,46,0.08)' },
  passed:    { label: 'PASSED',    color: T.ink4,      bg: 'rgba(14,12,10,0.04)' },
  // Riley kinds
  watching:  { label: 'WATCHING',  color: T.green,     bg: 'rgba(63,122,54,0.10)' },
  reviewing: { label: 'REVIEWING', color: T.amberDeep, bg: T.amberSoft, pulse: true },
  paused:    { label: 'PAUSED',    color: T.ink3,      bg: 'rgba(14,12,10,0.04)' },
  scaled:    { label: 'SCALED',    color: T.green,     bg: 'rgba(63,122,54,0.10)' },
  rotated:   { label: 'ROTATED',   color: T.blue,      bg: 'rgba(58,90,128,0.08)' },
  shifted:   { label: 'SHIFTED',   color: T.blue,      bg: 'rgba(58,90,128,0.08)' },
  alert:     { label: 'ALERT',     color: T.red,       bg: 'rgba(160,58,46,0.08)' },
};

// ── Agent config: every brand-specific value reads from window.AGENT.
// Missing keys fall back to Alex so the existing Alex Home keeps working.
function getAgent() {
  const A = (typeof window !== 'undefined' && window.AGENT) || {};
  const name = A.name || 'Alex';
  return {
    name,
    nameUpper: name.toUpperCase(),
    variants: A.variants || (typeof window !== 'undefined' ? window.ALEX_VARIANTS : null),
    accent: A.accent || { base: T.amber, deep: T.amberDeep, soft: T.amberSoft, paper: T.amberPaper },
    tabs: A.tabs || [
      { name: 'Alex', active: true },
      { name: 'Riley' },
      { name: 'Mira', muted: true },
    ],
    statusColor: A.statusColor || ((key, halted) => halted ? T.red
      : key === 'TALKING' ? T.green
      : key === 'WAITING' ? T.amber
      : T.ink4),
    statusPulse: A.statusPulse || ((key, halted) => !halted && (key === 'TALKING' || key === 'WAITING')),
    animState: A.animState || ((key, halted) => halted ? 'sleep'
      : key === 'TALKING' || key === 'WAITING' ? 'draft'
      : 'idle'),
    mission: A.mission || {
      subtitle: 'SDR · Tours pipeline · HotPod',
      title: "What is Alex configured for?",
      rows: [
        ['ROLE', 'SDR · qualify inbound leads, book tours'],
        ['PIPELINE', 'Tours pipeline · single funnel'],
        ['BRAND', 'HotPod · Bay Area studio'],
        ['CHANNELS', 'Meta Ads · HotPod inbox · tour calendar'],
      ],
    },
    composerPlaceholder: A.composerPlaceholder || 'Tell Alex what to do \u2014 "pause an hour", "follow up with Maya tonight"\u2026',
    needsYouLabel: A.needsYouLabel || `${name} needs you`,
    toastVoice: A.toastVoice || ((action) => (action.kind === 'pause') ? `Paused \u2014 ${action.detail}.`
      : (action.kind === 'resume') ? `Resumed. Picking up where I left off.`
      : (action.kind === 'halt') ? `Halted. Nothing going out until you resume.`
      : (action.kind === 'followup') ? `${action.label} \u2014 I'll handle it ${action.detail}.`
      : (action.kind === 'brief') ? `I'll brief you ${action.detail}.`
      : (action.kind === 'rule') ? `Rule updated \u2014 ${action.detail}.`
      : (action.kind === 'handoff') ? `Handed off. The thread is yours.`
      : (action.kind === 'context') ? `Noted. I'll factor that in next time we talk to them.`
      : (action.kind === 'command') ? `On it \u2014 ${action.label.toLowerCase()}.`
      : `Got it. Acting on "${action.detail || action.label}".`),
  };
}

// ── Avatar: no clip. Rounded pixel frame, full sprite visible. ─────
function AlexFrame({ size = 60, state = 'idle', variant = 'classic' }) {
  const AG = getAgent();
  const V = AG.variants && AG.variants[variant];
  if (!V) {
    return (
      <div style={frameStyle(size, AG.accent.soft)}>
        <span style={{ fontWeight: 700, fontSize: size * 0.42, color: AG.accent.deep }}>{AG.name[0]}</span>
      </div>
    );
  }
  return (
    <div style={frameStyle(size, AG.accent.soft)}>
      <window.AnimatedSprite frames={V.states[state]} palette={V.palette} size={size - 6} />
    </div>
  );
}
function frameStyle(size, bg) {
  return {
    width: size, height: size, borderRadius: Math.round(size * 0.18),
    background: bg, border: `1px solid ${T.hair}`,
    display: 'grid', placeItems: 'center', flexShrink: 0,
    boxShadow: 'inset 0 -8px 14px rgba(14,12,10,0.04)',
    overflow: 'hidden',
  };
}

// Small inline chip avatar (for activity rows etc.)
function AlexInlineChip({ size = 22, state = 'idle', variant = 'classic' }) {
  const AG = getAgent();
  const V = AG.variants && AG.variants[variant];
  if (!V) return null;
  return (
    <span style={{
      width: size, height: size, borderRadius: 4,
      background: AG.accent.soft, display: 'inline-grid', placeItems: 'center',
      overflow: 'hidden', verticalAlign: 'middle',
    }}>
      <window.AnimatedSprite frames={V.states[state]} palette={V.palette} size={size - 2} />
    </span>
  );
}

// ── Topbar ──────────────────────────────────────────────────────────
function Topbar({ onOpenPalette, compact }) {
  const AG = getAgent();
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: compact ? '12px 18px' : '14px 28px',
      borderBottom: `1px solid ${T.hair}`,
      background: T.bg, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 14 : 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark />
          {!compact && <span style={{ fontWeight: 600, fontSize: 14, color: T.ink, letterSpacing: '-0.005em' }}>Switchboard</span>}
        </div>
        <nav style={{ display: 'flex', gap: 2 }}>
          {AG.tabs.filter((t, i) => !compact || t.active || i < 1).map((t) => (
            <Tab key={t.name} name={t.name} active={!!t.active} muted={!!t.muted} />
          ))}
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 12 }}>
        <button onClick={onOpenPalette} style={{
          background: 'transparent', border: `1px solid ${T.hair}`,
          padding: '5px 10px 5px 12px', borderRadius: 4, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'inherit',
        }}>
          <span style={{ fontSize: 12.5, color: T.ink3 }}>Tell {AG.name}…</span>
          <span style={{
            fontFamily: 'JetBrains Mono', fontSize: 10.5, color: T.ink4,
            padding: '1px 5px', border: `1px solid ${T.hair}`, borderRadius: 3,
          }}>⌘K</span>
        </button>
        {!compact && <button style={btnGhost}>Settings</button>}
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: T.ink, color: '#fff',
          display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600,
        }}>M</div>
      </div>
    </header>
  );
}

const btnGhost = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 12.5, color: T.ink3, fontWeight: 500,
  padding: '6px 8px', borderRadius: 4,
};

function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22">
      <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill={T.ink} />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path d="M 7 11 Q 11 6.5, 15 11" stroke={T.amber} strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function Tab({ name, active, muted }) {
  return (
    <span style={{
      padding: '5px 10px', borderRadius: 4,
      fontSize: 13, fontWeight: active ? 600 : 500,
      color: active ? T.ink : muted ? T.ink4 : T.ink3,
      background: active ? 'rgba(14,12,10,0.05)' : 'transparent',
      cursor: 'pointer',
    }}>{name}</span>
  );
}

// ── Identity ───────────────────────────────────────────────────────
function Identity({ data, variant, halted, onHalt, onEditMission, compact }) {
  const AG = getAgent();
  const animState = AG.animState(data.statusKey, halted);
  const statusColor = AG.statusColor(data.statusKey, halted);
  const statusPulse = AG.statusPulse(data.statusKey, halted);
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: compact ? 12 : 16,
      padding: compact ? '18px 18px 14px' : '24px 28px 18px',
    }}>
      <AlexFrame size={compact ? 52 : 64} state={animState} variant={variant} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: compact ? 18 : 22, fontWeight: 600, color: T.ink, letterSpacing: '-0.015em' }}>{AG.name}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Dot color={statusColor} pulse={statusPulse} />
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: statusColor, textTransform: 'uppercase' }}>
              {halted ? 'HALTED' : data.statusKey}
            </span>
            {data.liveCount > 0 && (
              <span data-tabular style={{ fontSize: 11.5, color: T.ink3, fontFamily: 'JetBrains Mono' }}>· {data.liveCount}</span>
            )}
          </span>
        </div>
        <button onClick={onEditMission} title={`Edit ${AG.name}'s mission`} style={{
          marginTop: 4,
          all: 'unset', cursor: 'pointer',
          fontSize: 12.5, color: T.ink3, fontFamily: 'JetBrains Mono', letterSpacing: '0.02em',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}
        onMouseEnter={(e) => e.currentTarget.style.color = T.ink}
        onMouseLeave={(e) => e.currentTarget.style.color = T.ink3}
        >
          {AG.mission.subtitle}
          <span style={{ fontSize: 10, color: T.ink4 }}>✎</span>
        </button>
        {data.line && (
          <p style={{ margin: '12px 0 0', fontSize: compact ? 13.5 : 14, lineHeight: 1.5, color: T.ink2, maxWidth: 640, textWrap: 'pretty' }}>
            {data.line}
          </p>
        )}
      </div>
      <button onClick={onHalt} style={{
        background: 'transparent', border: `1px solid ${T.hair}`,
        padding: '6px 12px', borderRadius: 4, cursor: 'pointer',
        fontSize: 11.5, fontWeight: 600, color: halted ? T.green : T.red,
        letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'inherit',
      }}>{halted ? '▶ Resume' : '⏸ Halt'}</button>
    </div>
  );
}

function Dot({ color, pulse, size = 7 }) {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        animation: pulse ? 'ck-pulse 1.6s ease-out infinite' : 'none',
      }} />
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color }} />
    </span>
  );
}

// ── KPI strip — full or collapsed when approval present ────────────
function KPIStrip({ kpis, collapsed, compact }) {
  if (!kpis) return null;

  // Schema: either explicit `kpis.tiles[]` + `kpis.roi`, or legacy named fields.
  const tiles = kpis.tiles || legacyTiles(kpis);
  const roi   = kpis.roi   || legacyRoi(kpis);
  const headline = collapsedHeadline(kpis);

  if (collapsed) {
    return (
      <div style={{
        padding: compact ? '10px 18px' : '10px 28px',
        borderTop: `1px solid ${T.hair}`,
        borderBottom: `1px solid ${T.hair}`,
        background: T.bg,
        display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: T.ink4, textTransform: 'uppercase' }}>{kpis.range}</span>
        <span data-tabular style={{ fontSize: 13, color: T.ink, fontFamily: 'JetBrains Mono' }}>
          {headline}
        </span>
        <span style={{ flex: 1 }} />
        <button style={btnLink}>Open report →</button>
      </div>
    );
  }

  return (
    <div style={{
      padding: compact ? '14px 18px 18px' : '16px 28px 20px',
      borderTop: `1px solid ${T.hair}`,
      borderBottom: `1px solid ${T.hair}`,
      background: T.bg,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Eyebrow>{kpis.range}</Eyebrow>
        <button style={btnLink}>Open report →</button>
      </div>
      <div style={{
        marginTop: 12, display: 'grid',
        gridTemplateColumns: compact ? 'repeat(2, 1fr)' : `repeat(${tiles.length}, 1fr)`,
        rowGap: compact ? 14 : 0, columnGap: 18,
      }}>
        {tiles.map((tile, i) => <KPI key={i} {...tile} />)}
      </div>
      {roi && <ROIBar roi={roi} compact={compact} />}
    </div>
  );
}

// Legacy Alex tiles — derive 4 KPIs from the older flat schema.
function legacyTiles(k) {
  return [
    { label: 'bookings',      value: k.booked,        trend: k.bookedDelta },
    { label: 'leads worked',  value: k.leads,         trend: k.leadsDelta },
    { label: 'qualified',     value: k.qualifiedPct,  unit: '%', trend: k.qualifiedDelta },
    { label: 'ad spend',      value: `$${k.spend}` },
  ];
}
function legacyRoi(k) {
  if (!k.avgValue) return null;
  const earned = k.booked * k.avgValue;
  const ratio = k.spend > 0 ? earned / k.spend : 0;
  const ratioCap = Math.min(ratio, 6);
  const cpb = k.booked > 0 ? Math.round(k.spend / k.booked) : null;
  const onTarget = cpb !== null && cpb <= k.target;
  return {
    label: 'return on spend',
    leftMeta: `$${k.spend} spent`,
    rightMeta: { value: `$${earned.toLocaleString()}`, suffix: ' in tour value' },
    fillPct: (ratioCap / 6) * 100,
    breakEvenPct: (1 / 6) * 100,
    breakEvenLabel: 'break-even',
    scaleLeft: '$0',
    scaleRight: '6× spend',
    comparator: { value: cpb !== null ? `$${cpb} per booking` : '—', target: `target $${k.target}`, onTarget },
  };
}
function collapsedHeadline(k) {
  if (k.tiles) {
    // First non-unavailable tile is the headline
    const lead = k.tiles.find(t => !t.unavailable) || k.tiles[0];
    if (!lead) return null;
    return (
      <React.Fragment>
        <strong style={{ color: T.ink, fontWeight: 600 }}>{lead.value}</strong>
        {lead.unit && <span>{lead.unit}</span>}
        <span style={{ color: T.ink4 }}> {lead.label}</span>
        {lead.trend && <React.Fragment><span style={{ color: T.ink4 }}> · </span><span style={{ color: T.green, fontWeight: 500 }}>{lead.trend}</span></React.Fragment>}
      </React.Fragment>
    );
  }
  const cpb = k.booked > 0 ? Math.round(k.spend / k.booked) : null;
  return (
    <React.Fragment>
      <strong style={{ color: T.ink, fontWeight: 600 }}>{k.booked}</strong> bookings
      <span style={{ color: T.ink4 }}> · </span>
      <strong style={{ color: T.ink, fontWeight: 600 }}>${cpb}</strong> each
      <span style={{ color: T.ink4 }}> · </span>
      <span style={{ color: T.green, fontWeight: 500 }}>{k.bookedDelta}</span>
    </React.Fragment>
  );
}

function KPI({ label, value, unit, trend, unavailable, hint }) {
  const trendColor = trend?.startsWith('+') ? T.green : trend?.startsWith('-') ? T.red : T.ink4;
  if (unavailable) {
    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: T.ink3, textTransform: 'uppercase' }}>{label}</div>
        <div data-tabular style={{
          marginTop: 4, fontSize: 26, fontWeight: 600, color: T.ink5,
          letterSpacing: '-0.01em', lineHeight: 1,
        }}>—</div>
        {hint && (
          <button style={{
            marginTop: 4, all: 'unset', cursor: 'pointer',
            fontSize: 11, fontWeight: 500, color: T.ink3,
            fontFamily: 'JetBrains Mono', letterSpacing: '0.02em',
            borderBottom: `1px dashed ${T.hair}`,
          }}>{hint} →</button>
        )}
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: T.ink3, textTransform: 'uppercase' }}>{label}</div>
      <div data-tabular style={{
        marginTop: 4, fontSize: 26, fontWeight: 600, color: T.ink,
        letterSpacing: '-0.01em', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 3,
      }}>
        {value}
        {unit && <span style={{ fontSize: 13, color: T.ink3, fontWeight: 500 }}>{unit}</span>}
      </div>
      {trend && (
        <div data-tabular style={{
          marginTop: 4, fontSize: 11, fontWeight: 500, color: trendColor,
          fontFamily: 'JetBrains Mono', letterSpacing: '0.02em',
        }}>{trend}</div>
      )}
    </div>
  );
}

// ── ROI bar ── explicit-config shape from data; track + comparator pill.
function ROIBar({ roi, compact }) {
  const AG = getAgent();
  const comparator = roi.comparator;
  // Degraded mode: no fillPct → collapse the bar, just show the comparator pill.
  if (roi.degraded || roi.fillPct == null) {
    return (
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${T.hair}`,
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: T.ink3, textTransform: 'uppercase' }}>
          {roi.label || 'return on spend'}
        </span>
        <span style={{ flex: 1 }} />
        {comparator && (
          <span data-tabular style={{
            fontFamily: 'JetBrains Mono', fontSize: 12,
            color: T.ink3, fontWeight: 500,
            padding: '4px 10px', borderRadius: 999, border: `1px solid ${T.hair}`,
            background: T.paper,
          }}>
            {comparator.value}<span style={{ color: T.ink4 }}> · {comparator.target}</span>
          </span>
        )}
        {roi.degradedHint && (
          <span style={{ fontSize: 12, color: T.ink4 }}>{roi.degradedHint}</span>
        )}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px dashed ${T.hair}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: T.ink3, textTransform: 'uppercase' }}>
          {roi.label || 'return on spend'}
        </span>
        {roi.leftMeta && (
          <span data-tabular style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: T.ink2 }}>
            {roi.leftMeta}
            {roi.rightMeta && (
              <React.Fragment>
                <span style={{ color: T.ink4 }}> · </span>
                <span style={{ color: T.ink, fontWeight: 600 }}>{roi.rightMeta.value}</span>
                {roi.rightMeta.suffix && <span>{roi.rightMeta.suffix}</span>}
              </React.Fragment>
            )}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {comparator && (
          <span data-tabular style={{
            fontFamily: 'JetBrains Mono', fontSize: 12,
            color: comparator.onTarget ? T.green : T.amberDeep, fontWeight: 600,
          }}>
            {comparator.value}
            {comparator.target && <span style={{ color: T.ink4, fontWeight: 400 }}> · {comparator.target}</span>}
          </span>
        )}
      </div>
      <div style={{
        marginTop: 10, position: 'relative',
        height: 8, borderRadius: 4, background: 'rgba(14,12,10,0.06)',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, Math.min(100, roi.fillPct))}%`,
          background: `linear-gradient(90deg, ${AG.accent.soft} 0%, ${AG.accent.base} 100%)`,
        }} />
        {/* break-even tick */}
        {roi.breakEvenPct != null && (
          <div style={{
            position: 'absolute', left: `${roi.breakEvenPct}%`, top: -3, bottom: -3,
            width: 1, background: T.ink3,
          }} />
        )}
      </div>
      <div data-tabular style={{
        marginTop: 6, display: 'flex', justifyContent: 'space-between',
        fontFamily: 'JetBrains Mono', fontSize: 10, color: T.ink4, letterSpacing: '0.04em',
      }}>
        <span>{roi.scaleLeft || '0'}</span>
        {roi.breakEvenLabel && roi.breakEvenPct != null && (
          <span style={{ marginLeft: `${roi.breakEvenPct - 8}%`, color: T.ink3 }}>{roi.breakEvenLabel}</span>
        )}
        <span>{roi.scaleRight || ''}</span>
      </div>
    </div>
  );
}

function Eyebrow({ children, color }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
      color: color || T.ink3, textTransform: 'uppercase',
    }}>{children}</div>
  );
}

// ── Approval(s) — single object or array; campaign + risk are optional.
function ApprovalBlock({ data, onResolve, variant, compact }) {
  const items = Array.isArray(data) ? data : [data];
  if (items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 14,
                  margin: compact ? '16px 18px 0' : '20px 28px 0' }}>
      {items.map((it, i) => (
        <ApprovalCard key={it.id || i} data={it} idx={i} total={items.length}
                      onResolve={(r) => onResolve(r, i)} variant={variant} compact={compact} />
      ))}
    </div>
  );
}

function ApprovalCard({ data, idx, total, onResolve, variant, compact }) {
  const AG = getAgent();
  return (
    <section style={{
      padding: compact ? '16px 18px' : '20px 22px',
      background: T.amberPaper, borderRadius: 8,
      border: `1px solid ${T.amberSoft}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <AlexInlineChip size={22} state="draft" variant={variant} />
        <Eyebrow color={T.amberDeep}>{AG.needsYouLabel}</Eyebrow>
        <span data-tabular style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: T.amberDeep }}>· {data.askedAt}</span>
        {total > 1 && (
          <React.Fragment>
            <span style={{ flex: 1 }} />
            <span data-tabular style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: T.amberDeep, fontWeight: 600 }}>{idx + 1} of {total}</span>
          </React.Fragment>
        )}
      </div>
      <h2 style={{
        margin: 0, fontSize: compact ? 17 : 19, fontWeight: 600, color: T.ink,
        letterSpacing: '-0.01em', lineHeight: 1.3, textWrap: 'pretty',
      }}>{data.title}</h2>
      {data.campaign && (
        <div style={{
          marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 8,
          fontFamily: 'JetBrains Mono', fontSize: 11.5, color: T.ink3,
          letterSpacing: '0.02em',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: AG.accent.base }} />
          {data.campaign.name}
        </div>
      )}
      {data.body && (
        <p style={{ margin: '8px 0 0', maxWidth: 640, fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>
          {data.body}
        </p>
      )}
      {data.quote && (
        <div style={{
          margin: '12px 0 0', padding: '10px 14px', background: 'rgba(255,255,255,0.55)',
          borderRadius: 4, border: `1px solid ${T.amberSoft}`,
          fontSize: 13.5, lineHeight: 1.5, color: T.ink2,
        }}>
          <span style={{ color: T.amber, fontWeight: 600, marginRight: 3 }}>"</span>{data.quote}<span style={{ color: T.amber, fontWeight: 600, marginLeft: 3 }}>"</span>
          {data.quoteFrom && (
            <div data-tabular style={{ marginTop: 4, fontFamily: 'JetBrains Mono', fontSize: 10.5, color: T.ink4 }}>— {data.quoteFrom}</div>
          )}
        </div>
      )}
      {data.risk && (
        <div data-tabular style={{
          marginTop: 10, fontFamily: 'JetBrains Mono', fontSize: 11,
          color: T.amberDeep, letterSpacing: '0.04em',
        }}>⚠ {data.risk}</div>
      )}
      <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => onResolve('accept')} style={{
          background: T.amber, color: '#fff', border: `1px solid ${T.amberDeep}`,
          padding: '8px 16px', borderRadius: 4, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        }}>{data.primary || (data.presentation && data.presentation.primaryLabel) || 'Accept'}</button>
        <button onClick={() => onResolve('decline')} style={{
          background: '#fff', color: T.ink, border: `1px solid ${T.hair}`,
          padding: '8px 14px', borderRadius: 4, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>{data.secondary || (data.presentation && data.presentation.dismissLabel) || 'Decline'}</button>
        {data.tertiaryLabel && (
          <button style={{
            background: 'transparent', color: T.ink3, border: 'none',
            padding: '8px 6px', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
          }}>{data.tertiaryLabel}</button>
        )}
      </div>
    </section>
  );
}

// ── Activity ───────────────────────────────────────────────────────
function ActivityStream({ data, filter, setFilter, openSet, toggleOpen, variant, compact }) {
  const filters = data.filters || ['all', 'booked', 'escalations'];
  const filtered = data.activity.filter(it => {
    if (filter === 'all') return true;
    if (filter === 'booked') return it.kind === 'booked';
    if (filter === 'escalations') return it.kind === 'escalated' || it.kind === 'waiting';
    if (filter === 'approvals') return it.kind === 'waiting' || it.kind === 'reviewing';
    if (filter === 'changes') return ['paused', 'scaled', 'rotated', 'shifted'].includes(it.kind);
    return true;
  });
  return (
    <section style={{ padding: compact ? '16px 18px 28px' : '20px 28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 10 }}>
        <Eyebrow>Today · {data.today}</Eyebrow>
        <div style={{ display: 'flex', gap: 4 }}>
          {filters.map(k => (
            <button key={k} onClick={() => setFilter(k)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 11.5, color: filter === k ? T.ink : T.ink3,
              fontWeight: filter === k ? 600 : 500,
              padding: '4px 8px', borderRadius: 4, textTransform: 'capitalize',
              fontFamily: 'inherit',
            }}>{k}</button>
          ))}
        </div>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {filtered.map((it, i) => (
          <ActivityRow key={`${it.time}-${it.head}`} item={it} open={openSet.has(`${it.time}-${it.head}`)}
                       toggle={() => toggleOpen(`${it.time}-${it.head}`)} variant={variant} compact={compact} />
        ))}
        {filtered.length === 0 && (
          <li style={{ padding: '20px 0', fontSize: 13, color: T.ink4, fontFamily: 'JetBrains Mono', letterSpacing: '0.02em' }}>
            Nothing here yet.
          </li>
        )}
      </ul>
    </section>
  );
}

function ActivityRow({ item, open, toggle, variant, compact }) {
  const AG = getAgent();
  const meta = KIND_META[item.kind] || { label: (item.kind || '').toUpperCase(), color: T.ink3, bg: 'rgba(14,12,10,0.04)' };
  const expandable = item.preview || item.body;
  return (
    <li style={{ borderBottom: `1px solid ${T.hairSoft}` }}>
      <button onClick={() => expandable && toggle()} style={{
        all: 'unset', display: 'grid', width: '100%', boxSizing: 'border-box',
        gridTemplateColumns: compact ? '46px 96px 1fr 16px' : '54px 112px 1fr auto',
        gap: compact ? 10 : 14, alignItems: 'baseline', padding: '11px 0',
        cursor: expandable ? 'pointer' : 'default',
      }}>
        <span data-tabular style={{
          fontFamily: 'JetBrains Mono', fontSize: 11, color: T.ink4,
          letterSpacing: '0.02em', whiteSpace: 'nowrap',
        }}>{item.time}</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, height: 18,
          padding: '0 7px', borderRadius: 3, background: meta.bg,
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          color: meta.color, textTransform: 'uppercase',
          justifySelf: 'start', whiteSpace: 'nowrap',
        }}>
          {meta.pulse && <Dot color={meta.color} pulse size={5} />}
          {meta.label}
        </span>
        <span style={{ fontSize: compact ? 13 : 13.5, lineHeight: 1.45, color: T.ink, textWrap: 'pretty' }}>
          {item.head}
        </span>
        <span style={{
          color: T.ink4, fontSize: 14, fontFamily: 'JetBrains Mono',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform .15s ease', width: 14, textAlign: 'center',
        }}>{expandable ? '›' : ''}</span>
      </button>
      {open && (
        <div style={{ padding: compact ? '2px 0 14px 60px' : '2px 0 16px 76px' }}>
          {item.body && (
            <p style={{ margin: 0, fontSize: 13, color: T.ink2, lineHeight: 1.5, maxWidth: 600 }}>{item.body}</p>
          )}
          {item.preview && (
            <ThreadPreview msgs={item.preview} variant={variant} body={!!item.body} />
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={btnLink}>Open full thread →</button>
            {item.who && <button style={btnLink}>Tell {AG.name} about {item.who.split(' ')[0]}</button>}
            {item.who && item.replyable !== false && <button style={btnLink}>I&apos;ll reply to {item.who.split(' ')[0]}</button>}
          </div>
        </div>
      )}
    </li>
  );
}

function ThreadPreview({ msgs, variant, body }) {
  const AG = getAgent();
  const [reply, setReply] = React.useState('');
  return (
    <div style={{
      marginTop: body ? 12 : 0, padding: '12px 14px',
      background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 6,
      maxWidth: 640,
    }}>
      {msgs.map((m, i) => {
        const isAgent = m.from === AG.name;
        return (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{
              fontFamily: 'JetBrains Mono', fontSize: 10.5,
              color: isAgent ? AG.accent.base : T.ink3,
              letterSpacing: '0.04em', flexShrink: 0,
              width: 64,
            }}>{m.from.toUpperCase()}</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: T.ink2, textWrap: 'pretty' }}>{m.text}</span>
          </div>
        );
      })}
      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${T.hair}`,
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.ink4, letterSpacing: '0.08em', width: 64 }}>YOU</span>
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder={`Reply yourself, or ask ${AG.name} to draft something…`}
          style={{
            flex: 1, border: `1px solid ${T.hair}`, background: T.bg,
            borderRadius: 4, padding: '6px 10px', fontFamily: 'inherit',
            fontSize: 13, color: T.ink, outline: 'none',
          }}
        />
        <button style={{
          background: reply.trim() ? T.ink : T.ink5, color: '#fff', border: 'none',
          padding: '6px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
          cursor: reply.trim() ? 'pointer' : 'default', fontFamily: 'inherit',
        }}>Send as me</button>
        <button style={{
          background: 'transparent', color: T.ink3, border: `1px solid ${T.hair}`,
          padding: '6px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
        }}>Ask {AG.name} to draft</button>
      </div>
    </div>
  );
}

const btnLink = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  fontSize: 12, color: T.ink3, padding: 0,
  textDecoration: 'underline', textDecorationColor: 'rgba(14,12,10,0.15)',
  textUnderlineOffset: 3, fontFamily: 'inherit',
};

// ── Day-1 empty (narrator + setup) ─────────────────────────────────
function EmptyState({ data, variant, onConnect, compact }) {
  return (
    <section style={{ padding: compact ? '8px 18px 28px' : '12px 28px 32px' }}>
      {/* Narrator block — agent voice */}
      <div style={{
        padding: compact ? '18px 18px' : '20px 24px',
        background: T.amberPaper,
        border: `1px solid ${T.amberSoft}`,
        borderRadius: 8,
        display: 'flex', gap: 14, alignItems: 'flex-start',
      }}>
        <AlexFrame size={48} state="idle" variant={variant} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: T.amberDeep, textTransform: 'uppercase' }}>{data.narrator.eyebrow}</div>
          {data.narrator.lines.map((l, i) => (
            <p key={i} style={{
              margin: i === 0 ? '6px 0 0' : '8px 0 0',
              fontSize: compact ? 14 : 15, lineHeight: 1.5, color: T.ink, textWrap: 'pretty', maxWidth: 580,
            }}>{l}</p>
          ))}
          <div style={{
            marginTop: 14, padding: '8px 12px',
            background: 'rgba(255,255,255,0.55)', borderRadius: 4,
            border: `1px solid ${T.amberSoft}`,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: T.amberDeep, letterSpacing: '0.1em' }}>NEXT MOVE</span>
            <span style={{ fontSize: 13, color: T.ink2 }}>{data.narrator.nextMove}</span>
          </div>
        </div>
      </div>

      {/* Setup */}
      <div style={{
        marginTop: 18, padding: compact ? '16px 18px' : '18px 22px',
        background: T.paper, border: `1px solid ${T.hair}`, borderRadius: 8,
      }}>
        <Eyebrow>Setup · 1 of 4 ready</Eyebrow>
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {data.setup.map((s, i) => (
            <li key={s.key} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${T.hairSoft}`,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                border: `1.5px solid ${s.done ? T.green : T.ink5}`,
                background: s.done ? T.green : 'transparent',
                color: '#fff', display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>{s.done ? '✓' : ''}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: s.done ? 400 : 500, color: s.done ? T.ink3 : T.ink, textDecoration: s.done ? 'line-through' : 'none' }}>{s.label}</div>
                <div style={{ fontSize: 12, color: T.ink4, marginTop: 1 }}>{s.hint}</div>
              </div>
              {!s.done && (
                <button onClick={() => onConnect(s.key)} style={{
                  background: s.primary ? T.ink : 'transparent',
                  color: s.primary ? '#fff' : T.ink,
                  border: s.primary ? `1px solid ${T.ink}` : `1px solid ${T.hair}`,
                  padding: '7px 14px', borderRadius: 4,
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>{s.primary ? 'Connect →' : 'Connect'}</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Composer (bottom edge) — structured pending action + chips ─────
function Composer({ onSend, suggestions, disabled, onOpenPalette, compact }) {
  const AG = getAgent();
  const [text, setText] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const [pending, setPending] = React.useState(null);

  const parsedNow = window.parseCommand ? window.parseCommand(text) : null;

  const stage = () => {
    if (!text.trim()) return;
    const action = parsedNow || { kind: 'instruction', icon: '→', label: 'instruction', detail: text };
    setPending(action);
    setText('');
  };
  const commit = () => {
    if (!pending) return;
    onSend && onSend(pending);
    setPending(null);
  };
  const undo = () => setPending(null);

  return (
    <div style={{
      borderTop: `1px solid ${T.hair}`,
      background: T.bg,
      padding: compact ? '10px 18px 12px' : '12px 28px 14px',
      flexShrink: 0,
    }}>
      {/* Pending action chip */}
      {pending && (
        <div style={{
          marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px',
          background: T.amberPaper, border: `1px solid ${T.amberSoft}`,
          borderRadius: 6,
        }}>
          <span style={{ color: T.amber, fontSize: 14, width: 18, textAlign: 'center' }}>{pending.icon}</span>
          <span style={{ fontSize: 13, color: T.ink }}>
            <strong style={{ fontWeight: 600 }}>{pending.label}</strong>
            {pending.detail && <span style={{ color: T.ink3 }}> · {pending.detail}</span>}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={undo} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 12, color: T.ink3, padding: '4px 8px', fontFamily: 'inherit',
          }}>Undo</button>
          <button onClick={commit} style={{
            background: T.amber, color: '#fff', border: `1px solid ${T.amberDeep}`,
            padding: '6px 12px', borderRadius: 4, fontSize: 12.5, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Confirm</button>
        </div>
      )}
      {/* Contextual chips */}
      {!pending && suggestions && suggestions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setText(s); setTimeout(() => stageFromText(s, setPending), 0); }} style={{
              background: 'transparent', border: `1px solid ${T.hair}`,
              padding: '5px 12px', borderRadius: 999,
              fontSize: 12, color: T.ink3, fontFamily: 'inherit', cursor: 'pointer',
            }}>{s}</button>
          ))}
        </div>
      )}
      {/* Composer */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: T.paper, border: `1px solid ${focused ? T.ink5 : T.hair}`,
        borderRadius: 6, padding: '5px 6px 5px 14px',
        transition: 'border-color .15s ease',
        opacity: pending ? 0.55 : 1,
      }}>
        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: T.ink4, letterSpacing: '0.08em' }}>→ {AG.nameUpper}</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') stage(); }}
          disabled={!!pending || disabled}
          placeholder={
            disabled ? 'Halted — resume to send instructions'
            : pending ? 'Confirm or undo the action above…'
            : AG.composerPlaceholder
          }
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: 'inherit', fontSize: 14, color: T.ink, padding: '8px 0',
          }}
        />
        <button onClick={onOpenPalette} title='Open command palette' style={{
          background: 'transparent', border: `1px solid ${T.hair}`,
          padding: '4px 8px', borderRadius: 3, cursor: 'pointer',
          fontFamily: 'JetBrains Mono', fontSize: 10.5, color: T.ink3,
        }}>⌘K</button>
        <button onClick={stage} disabled={!text.trim() || !!pending || disabled} style={{
          background: text.trim() && !pending && !disabled ? T.ink : T.ink5,
          color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 4,
          fontSize: 12.5, fontWeight: 600,
          cursor: text.trim() && !pending && !disabled ? 'pointer' : 'default',
          fontFamily: 'inherit',
        }}>Send</button>
      </div>
    </div>
  );
}

// helper used by chip clicks
function stageFromText(text, setPending) {
  const action = window.parseCommand(text) || { kind: 'instruction', icon: '→', label: 'instruction', detail: text };
  setPending(action);
}

// ── Toast (Alex voice) ─────────────────────────────────────────────
function Toast({ text, onClose, variant }) {
  React.useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => onClose && onClose(), 3400);
    return () => clearTimeout(t);
  }, [text]);
  if (!text) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)',
      background: T.ink, color: '#fff',
      padding: '10px 14px', borderRadius: 6,
      fontSize: 13, fontWeight: 500, boxShadow: '0 6px 24px rgba(14,12,10,0.18)',
      display: 'flex', gap: 10, alignItems: 'center', zIndex: 60,
      maxWidth: 440,
    }}>
      <AlexInlineChip size={20} state="draft" variant={variant} />
      <span style={{ textWrap: 'pretty' }}>{text}</span>
    </div>
  );
}

// ── Mission editor (mini popover) ──────────────────────────────────
function MissionPopover({ onClose }) {
  const AG = getAgent();
  return (
    <div onMouseDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 90,
      background: 'rgba(14,12,10,0.28)', display: 'grid', placeItems: 'center',
    }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{
        width: 440, background: T.paper, borderRadius: 8,
        padding: '20px 22px', border: `1px solid ${T.hair}`,
        boxShadow: '0 20px 60px rgba(14,12,10,0.25)',
      }}>
        <Eyebrow>{AG.name}'s mission</Eyebrow>
        <h3 style={{ margin: '6px 0 0', fontSize: 17, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em' }}>
          {AG.mission.title}
        </h3>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 12px', alignItems: 'baseline' }}>
          {AG.mission.rows.map((row, i) => (
            <React.Fragment key={i}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: T.ink4, letterSpacing: '0.04em' }}>{row[0]}</span>
              <span style={{ fontSize: 13.5, color: T.ink, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {row[2] && (
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: row[2] === 'ok' ? T.green : row[2] === 'warn' ? T.amber : row[2] === 'off' ? T.ink5 : row[2],
                  }} />
                )}
                {row[1]}
              </span>
            </React.Fragment>
          ))}
        </div>
        <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'transparent', border: `1px solid ${T.hair}`, padding: '7px 12px',
            borderRadius: 4, fontSize: 12.5, color: T.ink3, cursor: 'pointer', fontFamily: 'inherit',
          }}>Close</button>
          <button style={{
            background: T.ink, color: '#fff', border: 'none', padding: '7px 14px',
            borderRadius: 4, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>Edit configuration</button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────
function AgentHome({ stateKey, variant = 'classic', mode = 'desktop' }) {
  const AG = getAgent();
  const data = window.STATES[stateKey];
  const compact = mode === 'mobile';
  const [filter, setFilter] = React.useState('all');
  const [halted, setHalted] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [approvalResolved, setApprovalResolved] = React.useState(() => new Set()); // resolved indices
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [missionOpen, setMissionOpen] = React.useState(false);
  const [openSet, setOpenSet] = React.useState(() => new Set());

  React.useEffect(() => {
    function onKey(e) {
      const k = e.key && e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleOpen = (k) => {
    setOpenSet(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const runAction = (action) => {
    setToast(AG.toastVoice(action));
    if (action.kind === 'pause' || action.kind === 'halt') setHalted(true);
    if (action.kind === 'resume') setHalted(false);
  };

  const approvals = data.approval
    ? (Array.isArray(data.approval) ? data.approval : [data.approval])
    : [];
  const unresolvedApprovals = approvals
    .map((a, i) => ({ a, i }))
    .filter(({ i }) => !approvalResolved.has(i));
  const hasOpenApproval = unresolvedApprovals.length > 0;
  const isEmpty = !!data.narrator;

  return (
    <div data-screen-label={`${mode} · ${stateKey}`} style={{
      background: T.bg, color: T.ink, height: '100%',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative', overflow: 'hidden',
    }}>
      <Topbar onOpenPalette={() => setPaletteOpen(true)} compact={compact} />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <Identity data={data} variant={variant} halted={halted}
                  onHalt={() => { setHalted(h => !h); setToast(halted ? 'Resumed.' : 'Halted. Nothing going out.'); }}
                  onEditMission={() => setMissionOpen(true)}
                  compact={compact} />
        {isEmpty ? (
          <EmptyState data={data} variant={variant}
                      onConnect={(k) => setToast(k === 'meta' ? 'Opening Meta Ads connector…' : 'Opening connector…')}
                      compact={compact} />
        ) : (
          <React.Fragment>
            <KPIStrip kpis={data.kpis} collapsed={hasOpenApproval} compact={compact} />
            {hasOpenApproval && (
              <ApprovalBlock
                data={unresolvedApprovals.map(({ a }) => a)}
                variant={variant} compact={compact}
                onResolve={(r, slotIdx) => {
                  const realIdx = unresolvedApprovals[slotIdx].i;
                  const card = unresolvedApprovals[slotIdx].a;
                  setApprovalResolved(prev => { const n = new Set(prev); n.add(realIdx); return n; });
                  const t = r === 'accept'
                    ? (card.acceptToast || `Accepted — ${card.title}`)
                    : (card.declineToast || `Declined — ${card.title}`);
                  setToast(t);
                }}
              />
            )}
            <ActivityStream data={data} filter={filter} setFilter={setFilter}
                            openSet={openSet} toggleOpen={toggleOpen}
                            variant={variant} compact={compact} />
          </React.Fragment>
        )}
      </div>
      <Composer
        onSend={runAction}
        suggestions={data.suggestions}
        disabled={halted && data.statusKey !== 'IDLE'}
        onOpenPalette={() => setPaletteOpen(true)}
        compact={compact}
      />
      <Toast text={toast} onClose={() => setToast(null)} variant={variant} />
      <window.CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onRun={runAction} />
      {missionOpen && <MissionPopover onClose={() => setMissionOpen(false)} />}
    </div>
  );
}

window.AgentHome = AgentHome;
