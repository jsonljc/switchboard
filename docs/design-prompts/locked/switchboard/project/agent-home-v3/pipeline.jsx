// Opportunity Pipeline kanban — Switchboard / Mercury Tools tier.
// Lives at agent-home-v3/Pipeline.html. Reads fixtures from pipeline-data.jsx.
// Visual register matches Alex Home v2 (cockpit.jsx) — same paper/ink palette,
// 11px tracked eyebrows, JetBrains Mono for tabular bits, subtle hairlines.

const P = {
  bg:      'hsl(45 25% 98%)',   // page paper, per spec
  surface: '#FFFFFF',
  ink:     '#0E0C0A',
  ink2:    '#3A332B',
  ink3:    '#6B6052',
  ink4:    '#A39786',
  ink5:    '#C8BEAE',
  hair:    'rgba(14, 12, 10, 0.08)',
  hairSoft:'rgba(14, 12, 10, 0.04)',
  amber:   'hsl(30 55% 46%)',   // operator accent, per spec
  amberDeep:'hsl(30 60% 32%)',
  amberSoft:'hsl(38 70% 86%)',
  amberPaper:'hsl(42 70% 92%)',
  green:   '#3F7A36',
  red:     '#A03A2E',
  blue:    '#3A5A80',
};

// ── helpers ─────────────────────────────────────────────────────────
function formatSGD(cents, { showFree = false } = {}) {
  if (cents == null) return showFree ? '\u2014' : '\u2014';
  const dollars = Math.round(cents / 100);
  return 'S$' + dollars.toLocaleString();
}
function formatSGDCompact(cents) {
  if (cents == null) return null;
  const dollars = cents / 100;
  if (dollars >= 10000) return 'S$' + (dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1) + 'k';
  return 'S$' + Math.round(dollars).toLocaleString();
}
function relTime(iso) {
  const t = new Date(iso).getTime();
  const now = new Date(2026, 4, 13, 12, 0, 0).getTime(); // pin "now" to fixture base
  const diff = Math.max(0, now - t);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 30) return days + 'd ago';
  return Math.round(days / 30) + 'mo ago';
}
const channelGlyph = (c) => c === 'whatsapp' ? 'wa' : c === 'telegram' ? 'tg' : 'dash';

const TERMINAL = new Set(['won', 'lost']);
const PARKING = new Set(['nurturing']);

// ── Topbar (matches Alex Home v2) ───────────────────────────────────
function Topbar() {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 28px',
      borderBottom: `1px solid ${P.hair}`,
      background: P.bg, position: 'sticky', top: 0, zIndex: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark />
          <span style={{ fontWeight: 600, fontSize: 14, color: P.ink, letterSpacing: '-0.005em' }}>Switchboard</span>
        </div>
        <nav style={{ display: 'flex', gap: 2 }}>
          <Tab name="Alex" />
          <Tab name="Riley" active />
          <Tab name="Mira" muted />
          <span style={{ width: 14 }} />
          <Tab name="Pipeline" active sub />
          <Tab name="Contacts" />
          <Tab name="Reports" muted />
        </nav>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          fontFamily: 'JetBrains Mono', fontSize: 11, color: P.ink4,
          letterSpacing: '0.04em',
        }}>SGD · Singapore</span>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: P.ink, color: '#fff',
          display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600,
        }}>M</div>
      </div>
    </header>
  );
}
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22">
      <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill={P.ink} />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path d="M 7 11 Q 11 6.5, 15 11" stroke={P.amber} strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function Tab({ name, active, muted, sub }) {
  return (
    <span style={{
      padding: '5px 10px', borderRadius: 4,
      fontSize: sub ? 12.5 : 13, fontWeight: active ? 600 : 500,
      color: active ? P.ink : muted ? P.ink4 : P.ink3,
      background: active ? 'rgba(14,12,10,0.05)' : 'transparent',
      cursor: 'pointer',
      borderBottom: active && sub ? `1.5px solid ${P.amber}` : 'none',
      borderRadius: active && sub ? 0 : 4,
    }}>{name}</span>
  );
}

// ── Page header ─────────────────────────────────────────────────────
function PageHeader({ snapshot, saving }) {
  const totalOpen = snapshot.stages
    .filter(s => !TERMINAL.has(s.stage) && !PARKING.has(s.stage))
    .reduce((sum, s) => sum + s.totalValue, 0);
  const totalWon = snapshot.stages.find(s => s.stage === 'won')?.totalValue || 0;
  const openCount = snapshot.stages
    .filter(s => !TERMINAL.has(s.stage))
    .reduce((sum, s) => sum + s.count, 0);
  return (
    <div style={{ padding: '24px 28px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <Eyebrow>Mercury Tools · Pipeline</Eyebrow>
          <h1 style={{
            margin: '8px 0 0', fontFamily: '"Cormorant Garamond", "Times New Roman", serif',
            fontWeight: 500, fontSize: 38, lineHeight: 1.05, color: P.ink,
            letterSpacing: '-0.01em',
          }}>
            Opportunity pipeline
          </h1>
          <p style={{
            margin: '8px 0 0', fontSize: 13.5, color: P.ink3, maxWidth: 540,
            lineHeight: 1.55, textWrap: 'pretty',
          }}>
            Every active deal across all eight stages. Drag a card to move it &mdash; the change
            saves quietly. Won and lost columns are dimmed; nurturing parks the long tail.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '0 28px', alignItems: 'baseline' }}>
          <StatTile label="open pipeline" value={formatSGDCompact(totalOpen)} sub={`${openCount} opportunities`} />
          <StatTile label="won this period" value={formatSGDCompact(totalWon)} sub={`${snapshot.stages.find(s => s.stage === 'won')?.count || 0} captured`} tone="accent" />
          <SavingIndicator saving={saving} />
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, tone }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div data-tabular style={{
        marginTop: 4, fontSize: 22, fontWeight: 600,
        color: tone === 'accent' ? P.amberDeep : P.ink,
        letterSpacing: '-0.01em', fontFamily: 'JetBrains Mono',
      }}>{value}</div>
      <div style={{ marginTop: 2, fontSize: 11, color: P.ink4, fontFamily: 'JetBrains Mono', letterSpacing: '0.02em' }}>{sub}</div>
    </div>
  );
}

function SavingIndicator({ saving }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 92 }}>
      <Eyebrow>state</Eyebrow>
      <div data-tabular style={{
        marginTop: 4, fontSize: 13, fontWeight: 500,
        color: saving ? P.amberDeep : P.ink3,
        fontFamily: 'JetBrains Mono', letterSpacing: '0.02em',
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 28,
      }}>
        {saving ? (
          <React.Fragment>
            saving<span className="pl-savedot" /><span className="pl-savedot" /><span className="pl-savedot" />
          </React.Fragment>
        ) : (
          <React.Fragment>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: P.green }} />
            synced
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function Eyebrow({ children, color }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
      color: color || P.ink3, textTransform: 'uppercase',
    }}>{children}</div>
  );
}

// ── Filter strip ────────────────────────────────────────────────────
function FilterStrip({ filters, setFilters, total, filteredCount }) {
  const set = (patch) => setFilters({ ...filters, ...patch });
  const reset = () => setFilters({ range: 'all', qualifiedOnly: false });
  const isFiltered = filters.range !== 'all' || filters.qualifiedOnly;

  return (
    <div style={{
      padding: '12px 28px',
      borderTop: `1px solid ${P.hair}`,
      borderBottom: `1px solid ${P.hair}`,
      background: P.bg,
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
    }}>
      <FilterGroup label="updated">
        <Segment value={filters.range} onChange={(v) => set({ range: v })} options={[
          { value: 'all',  label: 'any time' },
          { value: '24h',  label: '24h' },
          { value: '7d',   label: '7d'  },
          { value: '30d',  label: '30d' },
        ]} />
      </FilterGroup>
      <Divider />
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        fontSize: 12.5, color: P.ink2, userSelect: 'none',
      }}>
        <input type="checkbox" checked={filters.qualifiedOnly}
          onChange={(e) => set({ qualifiedOnly: e.target.checked })}
          style={{ accentColor: P.amber, width: 14, height: 14, margin: 0 }} />
        Qualified only
      </label>

      <span style={{ flex: 1 }} />

      <span data-tabular style={{
        fontFamily: 'JetBrains Mono', fontSize: 11.5, color: P.ink3, letterSpacing: '0.02em',
      }}>
        showing <strong style={{ color: P.ink, fontWeight: 600 }}>{filteredCount}</strong>
        <span style={{ color: P.ink4 }}> of {total}</span>
      </span>
      {isFiltered && (
        <button onClick={reset} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 12, color: P.ink3, padding: 0,
          textDecoration: 'underline', textDecorationColor: 'rgba(14,12,10,0.15)',
          textUnderlineOffset: 3, fontFamily: 'inherit',
        }}>Clear filters</button>
      )}
    </div>
  );
}
function FilterGroup({ label, children }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
        color: P.ink4, textTransform: 'uppercase',
      }}>{label}</span>
      {children}
    </div>
  );
}
function Divider() {
  return <span style={{ width: 1, height: 16, background: P.hair }} />;
}
function Segment({ value, onChange, options, mono }) {
  return (
    <div style={{
      display: 'inline-flex', background: P.surface,
      border: `1px solid ${P.hair}`, borderRadius: 4, padding: 2,
    }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            background: active ? 'rgba(14,12,10,0.06)' : 'transparent',
            border: 'none', cursor: 'pointer', fontFamily: mono ? 'JetBrains Mono' : 'inherit',
            fontSize: mono ? 11 : 12, fontWeight: active ? 600 : 500,
            color: active ? P.ink : P.ink3,
            padding: '4px 10px', borderRadius: 3, letterSpacing: mono ? '0.04em' : '0',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// ── Column header + body ────────────────────────────────────────────
function Column({ stage, opportunities, onDrop, onDragOver, onDragLeave, dragOver, onCardDragStart, onCardDragEnd, draggingId, onOpenCard }) {
  const tone = stage.tone;
  const muted = tone === 'closed' || tone === 'parking';
  const accent = tone === 'accent';
  // Aggregate
  const count = opportunities.length;
  const sum = opportunities.reduce((s, o) => {
    if (TERMINAL.has(o.stage)) return s + (o.revenueTotal || 0);
    return s + (o.estimatedValue || 0);
  }, 0);

  return (
    <section
      className="pl-col"
      data-stage={stage.key}
      data-over={dragOver ? 'true' : 'false'}
      onDragOver={(e) => { e.preventDefault(); onDragOver(stage.key); }}
      onDragLeave={() => onDragLeave(stage.key)}
      onDrop={(e) => { e.preventDefault(); onDrop(stage.key); }}
      style={{
        flex: '0 0 288px',
        display: 'flex', flexDirection: 'column',
        background: tone === 'parking' ? 'rgba(14,12,10,0.025)' : P.bg,
        borderRight: `1px solid ${P.hair}`,
        borderLeft: stage.key === 'nurturing' ? `1px dashed ${P.ink5}` : 'none',
        opacity: muted ? 0.78 : 1,
        transition: 'background .15s ease, box-shadow .15s ease',
        position: 'relative',
      }}>
      <header style={{
        padding: '14px 14px 10px',
        borderBottom: `1px solid ${P.hair}`,
        background: P.bg,
        position: 'sticky', top: 0, zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
            color: accent ? P.amberDeep : muted ? P.ink4 : P.ink2,
            textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 7,
          }}>
            {accent && <span style={{ width: 5, height: 5, borderRadius: '50%', background: P.amber }} />}
            {tone === 'parking' && <span style={{ width: 5, height: 5, border: `1px solid ${P.ink4}`, background: 'transparent' }} />}
            {stage.label}
          </span>
          <span data-tabular style={{
            fontFamily: 'JetBrains Mono', fontSize: 11.5, fontWeight: 600,
            color: muted ? P.ink4 : P.ink2,
          }}>{count}</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span data-tabular style={{
            fontFamily: 'JetBrains Mono', fontSize: 13, fontWeight: 600,
            color: muted ? P.ink3 : P.ink, letterSpacing: '-0.005em',
          }}>
            {sum > 0 ? formatSGD(sum) : <span style={{ color: P.ink5, fontWeight: 400 }}>{TERMINAL.has(stage.key) ? 'S$0' : '\u2014'}</span>}
          </span>
          <span style={{ fontSize: 10.5, color: P.ink4, fontFamily: 'JetBrains Mono', letterSpacing: '0.02em', textTransform: 'lowercase' }}>
            {stage.subtitle}
          </span>
        </div>
      </header>
      <div className="pl-col-body" style={{
        flex: 1, padding: '10px 10px 28px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 8,
        minHeight: 320, maxHeight: 'calc(100vh - 340px)',
      }}>
        {opportunities.length === 0
          ? <EmptyColumn stage={stage} />
          : opportunities.map(o => (
              <OpportunityCard key={o.id} opp={o} muted={muted} accent={accent}
                onDragStart={onCardDragStart} onDragEnd={onCardDragEnd}
                dragging={draggingId === o.id} onOpen={onOpenCard} />
            ))
        }
      </div>
    </section>
  );
}

function EmptyColumn({ stage }) {
  const copy = {
    interested: 'No fresh leads parked here.',
    qualified:  'Nothing qualified waiting.',
    quoted:     'No quotes outstanding.',
    booked:     'No upcoming appointments.',
    showed:     'Nobody in clinic right now.',
    won:        'No wins in this view.',
    lost:       'Nothing lost — quiet column.',
    nurturing:  'Long-tail empty. Nice.',
  }[stage.key] || 'Empty.';
  return (
    <div style={{
      marginTop: 12, padding: '20px 14px',
      border: `1px dashed ${P.ink5}`, borderRadius: 6,
      fontSize: 12.5, color: P.ink4, textAlign: 'center', lineHeight: 1.5,
      fontFamily: 'JetBrains Mono', letterSpacing: '0.01em',
    }}>{copy}</div>
  );
}

// ── Opportunity card ────────────────────────────────────────────────
function OpportunityCard({ opp, muted, accent, onDragStart, onDragEnd, dragging, onOpen }) {
  const [hover, setHover] = React.useState(false);
  const objCount = (opp.objections || []).filter(o => !o.resolvedAt).length;
  const showValue = TERMINAL.has(opp.stage) ? opp.revenueTotal : opp.estimatedValue;
  const valueDisplay = showValue ? formatSGD(showValue) : null;
  const channel = opp.contact.primaryChannel;
  return (
    <article
      className="pl-card"
      data-dragging={dragging ? 'true' : 'false'}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', opp.id);
        onDragStart(opp.id);
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(opp)}
      style={{
        background: P.surface,
        border: `1px solid ${hover ? P.ink5 : P.hair}`,
        borderRadius: 6,
        padding: '11px 12px 12px',
        cursor: 'grab',
        position: 'relative',
        boxShadow: hover ? '0 1px 0 rgba(14,12,10,0.04)' : 'none',
        transition: 'border-color .12s ease, box-shadow .12s ease, opacity .12s ease',
      }}>
      {/* Row 1: service name + value */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontSize: 13.5, fontWeight: 600, color: muted ? P.ink2 : P.ink,
          lineHeight: 1.35, textWrap: 'pretty', letterSpacing: '-0.005em', flex: 1, minWidth: 0,
        }}>
          {opp.serviceName}
        </span>
        {valueDisplay && (
          <span data-tabular style={{
            flex: '0 0 auto',
            fontFamily: 'JetBrains Mono', fontSize: 11.5, fontWeight: 600,
            color: accent ? P.amberDeep : opp.stage === 'won' ? P.green : P.ink2,
            padding: '2px 7px', borderRadius: 3,
            background: accent ? P.amberSoft : opp.stage === 'won' ? 'rgba(63,122,54,0.10)' : 'rgba(14,12,10,0.04)',
            border: `1px solid ${accent ? P.amberSoft : 'transparent'}`,
          }}>{valueDisplay}</span>
        )}
      </div>

      {/* Row 2: contact */}
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 12.5, color: P.ink3, fontWeight: 450,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
        }}>{opp.contact.name}</span>
        {opp.assignedStaff && (
          <span style={{
            flex: '0 0 auto',
            fontFamily: 'JetBrains Mono', fontSize: 10, color: P.ink4, letterSpacing: '0.04em',
            padding: '1px 5px', borderRadius: 2,
            border: `1px solid ${P.hair}`, background: P.bg,
          }}>{opp.assignedStaff}</span>
        )}
      </div>

      {/* Row 3: meta — objections, updated */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {objCount > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontFamily: 'JetBrains Mono', fontSize: 10.5, fontWeight: 600,
            color: P.amberDeep,
            padding: '1px 6px', borderRadius: 2,
            border: `1px solid ${P.amberSoft}`,
          }}>
            <span style={{
              width: 4, height: 4, borderRadius: '50%', background: P.amber,
            }} />
            {objCount} obj
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span data-tabular style={{
          fontFamily: 'JetBrains Mono', fontSize: 10.5, color: P.ink4, letterSpacing: '0.02em',
        }}>{relTime(opp.updatedAt)}</span>
      </div>

      {/* Hover affordance */}
      {hover && (
        <div style={{
          position: 'absolute', right: 10, top: 10,
          fontSize: 10, fontFamily: 'JetBrains Mono', color: P.ink4, letterSpacing: '0.04em',
          background: 'transparent',
        }}>↗</div>
      )}
    </article>
  );
}

// ── Detail drawer (slides in on card click) ─────────────────────────
function DetailDrawer({ opp, onClose }) {
  if (!opp) return null;
  const channel = opp.contact.primaryChannel;
  return (
    <div onMouseDown={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 90,
      background: 'rgba(14,12,10,0.28)',
      display: 'flex', justifyContent: 'flex-end',
    }}>
      <aside onMouseDown={(e) => e.stopPropagation()} style={{
        width: 420, maxWidth: '92vw', height: '100%', background: P.surface,
        borderLeft: `1px solid ${P.hair}`, boxShadow: '-12px 0 30px rgba(14,12,10,0.12)',
        display: 'flex', flexDirection: 'column',
        animation: 'pl-fadein .18s ease',
      }}>
        <div style={{
          padding: '18px 22px', borderBottom: `1px solid ${P.hair}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0 }}>
            <Eyebrow color={P.amberDeep}>{(window.PIPELINE_STAGES.find(s => s.key === opp.stage) || {}).label}</Eyebrow>
            <h2 style={{
              margin: '6px 0 0', fontSize: 19, fontWeight: 600, color: P.ink,
              letterSpacing: '-0.01em', lineHeight: 1.3, textWrap: 'pretty',
            }}>{opp.serviceName}</h2>
            <div style={{ marginTop: 4, fontSize: 13, color: P.ink3 }}>
              {opp.contact.name}
            </div>
          </div>
          <button onClick={onClose} style={{
            all: 'unset', cursor: 'pointer', fontSize: 16, color: P.ink3,
            padding: 4, lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          <Field label="value">
            <span data-tabular style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 600 }}>
              {opp.estimatedValue ? formatSGD(opp.estimatedValue) : <span style={{ color: P.ink4 }}>not estimated</span>}
            </span>
            {opp.revenueTotal > 0 && (
              <span data-tabular style={{ marginLeft: 10, fontFamily: 'JetBrains Mono', fontSize: 12, color: P.green }}>
                · {formatSGD(opp.revenueTotal)} captured
              </span>
            )}
          </Field>
          <Field label="timeline">
            {opp.timeline || 'unknown'}
            <span style={{ color: P.ink4 }}> · </span>
            <span style={{ color: P.ink3 }}>price · {opp.priceReadiness || 'unknown'}</span>
          </Field>
          {opp.assignedStaff && (
            <Field label="staff">
              {opp.assignedStaff}
            </Field>
          )}
          {opp.objections && opp.objections.length > 0 && (
            <Field label="objections">
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {opp.objections.map((o, i) => (
                  <li key={i} style={{ fontSize: 12.5, color: P.ink2, padding: '3px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: o.resolvedAt ? P.green : P.amber }} />
                    {o.category.replace(/_/g, ' ')}
                    <span style={{ color: P.ink4, fontFamily: 'JetBrains Mono', fontSize: 10.5 }}>· {relTime(o.raisedAt)}</span>
                    {o.resolvedAt && <span style={{ color: P.green, fontSize: 11 }}>· resolved</span>}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {opp.notes && <Field label="notes"><span style={{ lineHeight: 1.5 }}>{opp.notes}</span></Field>}
          {opp.lostReason && <Field label="lost reason"><span style={{ color: P.red }}>{opp.lostReason}</span></Field>}
          <Field label="qualification">
            {opp.qualificationComplete
              ? <span style={{ color: P.green }}>complete</span>
              : <span style={{ color: P.ink4 }}>incomplete</span>}
          </Field>
          <Field label="dates">
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontFamily: 'JetBrains Mono', fontSize: 11.5, color: P.ink3 }}>
              <span>opened</span><span data-tabular>{relTime(opp.openedAt)}</span>
              <span>updated</span><span data-tabular>{relTime(opp.updatedAt)}</span>
              {opp.closedAt && <React.Fragment><span>closed</span><span data-tabular>{relTime(opp.closedAt)}</span></React.Fragment>}
            </div>
          </Field>
        </div>
        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${P.hair}`,
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <button style={{
            flex: 1, background: P.ink, color: '#fff', border: 'none',
            padding: '9px 14px', borderRadius: 4, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Open contact →</button>
          <button onClick={onClose} style={{
            background: 'transparent', color: P.ink3, border: `1px solid ${P.hair}`,
            padding: '9px 14px', borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>Close</button>
        </div>
      </aside>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginTop: 5, fontSize: 13, color: P.ink2, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────
function Toast({ text, onClose }) {
  React.useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => onClose && onClose(), 3000);
    return () => clearTimeout(t);
  }, [text, onClose]);
  if (!text) return null;
  return (
    <div className="pl-toast" style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: P.ink, color: '#fff',
      padding: '10px 16px', borderRadius: 6,
      fontSize: 13, fontWeight: 500, boxShadow: '0 6px 24px rgba(14,12,10,0.18)',
      zIndex: 100, maxWidth: 440,
      fontFamily: 'JetBrains Mono', letterSpacing: '0.01em',
    }}>{text}</div>
  );
}

// ── Page ────────────────────────────────────────────────────────────
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "showParking": true,
  "valueDisplay": "stage_aware"
}/*EDITMODE-END*/;

function PipelinePage() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [opps, setOpps] = React.useState(window.PIPELINE_FIXTURES);
  const [filters, setFilters] = React.useState({ range: 'all', qualifiedOnly: false });
  const [draggingId, setDraggingId] = React.useState(null);
  const [overStage, setOverStage] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [openOpp, setOpenOpp] = React.useState(null);
  const saveTimer = React.useRef(null);

  // Filter logic
  const NOW = new Date(2026, 4, 13, 12, 0, 0).getTime();
  const RANGES = { '24h': 24 * 3600e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3 };
  const filtered = opps.filter(o => {
    if (filters.range !== 'all') {
      const diff = NOW - new Date(o.updatedAt).getTime();
      if (diff > RANGES[filters.range]) return false;
    }
    if (filters.qualifiedOnly && !o.qualificationComplete) return false;
    return true;
  });

  const stages = window.PIPELINE_STAGES.filter(s => t.showParking || s.key !== 'nurturing');

  const snapshot = {
    stages: stages.map(s => {
      const items = filtered.filter(o => o.stage === s.key);
      return {
        stage: s.key,
        count: items.length,
        totalValue: items.reduce((sum, o) => sum + (TERMINAL.has(o.stage) ? (o.revenueTotal || 0) : (o.estimatedValue || 0)), 0),
      };
    }),
  };

  // Drag-and-drop
  const onCardDragStart = (id) => setDraggingId(id);
  const onCardDragEnd = () => { setDraggingId(null); setOverStage(null); };
  const onDragOver = (stageKey) => { if (overStage !== stageKey) setOverStage(stageKey); };
  const onDragLeave = (stageKey) => { if (overStage === stageKey) setOverStage(null); };
  const onDrop = (stageKey) => {
    if (!draggingId) return;
    const opp = opps.find(o => o.id === draggingId);
    if (!opp || opp.stage === stageKey) { setOverStage(null); return; }
    const stageLabel = window.PIPELINE_STAGES.find(s => s.key === stageKey)?.label || stageKey;
    setOpps(prev => prev.map(o => o.id === draggingId
      ? { ...o, stage: stageKey, updatedAt: new Date().toISOString(), closedAt: TERMINAL.has(stageKey) ? new Date().toISOString() : null }
      : o
    ));
    setOverStage(null);
    setDraggingId(null);
    // Optimistic quiet save
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(false);
      setToast(`Moved ${opp.contact.name.split(' ')[0]} to ${stageLabel}.`);
    }, 700);
  };

  return (
    <React.Fragment>
      <div style={{ background: P.bg, minHeight: '100vh', color: P.ink }}>
        <Topbar />
        <div style={{ maxWidth: '74rem', margin: '0 auto' }}>
          <PageHeader snapshot={snapshot} saving={saving} />
          <FilterStrip filters={filters} setFilters={setFilters} total={opps.length} filteredCount={filtered.length} />
        </div>

        {/* Board — extends to full viewport for horizontal scroll, but inset to match content */}
        <div className="pl-board" style={{
          overflowX: 'auto',
          padding: '20px 28px 40px',
        }}>
          <div style={{
            display: 'flex',
            border: `1px solid ${P.hair}`,
            borderRadius: 6,
            background: P.bg,
            overflow: 'hidden',
            minWidth: 'fit-content',
          }}>
            {stages.map(stage => (
              <Column
                key={stage.key}
                stage={stage}
                opportunities={filtered.filter(o => o.stage === stage.key)}
                dragOver={overStage === stage.key}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                draggingId={draggingId}
                onOpenCard={setOpenOpp}
              />
            ))}
          </div>
          {/* Footnote */}
          <p style={{
            margin: '14px 2px 0', fontSize: 11.5, color: P.ink4,
            fontFamily: 'JetBrains Mono', letterSpacing: '0.02em',
          }}>
            won &amp; lost are terminal · nurturing parks the long tail · drag cards to move
          </p>
        </div>
      </div>

      <DetailDrawer opp={openOpp} onClose={() => setOpenOpp(null)} />
      <Toast text={toast} onClose={() => setToast(null)} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Board">
          <TweakToggle label="Show nurturing column" value={t.showParking !== false}
            onChange={(v) => setTweak('showParking', v)} />
        </TweakSection>
        <TweakSection label="Demo">
          <TweakButton label="Reset fixtures" onClick={() => {
            setOpps(window.PIPELINE_FIXTURES);
            setToast('Fixtures reset.');
          }} />
        </TweakSection>
      </TweaksPanel>
    </React.Fragment>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PipelinePage />);
