// ⌘K command palette + NL parser for the composer.
// Parser returns a structured "pending action" chip with a label, an icon hint,
// and an apply() side-effect. Composer shows the chip; user confirms.

// ── NL parser ─────────────────────────────────────────────────────
// Very lightweight — pattern matchers over the input.
function parseCommand(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;

  // pause [for] N (min|minute|m|h|hour|hours)
  const pauseDur = s.match(/^pause(?:\s+for)?\s+(?:an?\s+|(\d+)\s*)?(min(?:ute)?s?|m|h|hours?|hr)\b/);
  if (pauseDur) {
    const n = pauseDur[1] ? parseInt(pauseDur[1], 10) : 1;
    const unit = pauseDur[2];
    const isHour = /^h/.test(unit);
    const mins = isHour ? n * 60 : n;
    const until = new Date(Date.now() + mins * 60000);
    return {
      kind: 'pause',
      icon: '⏸',
      label: `pause · ${isHour ? n + 'h' : n + 'm'}`,
      detail: `until ${fmtTime(until)}`,
    };
  }
  // pause until 3 PM
  const pauseUntil = s.match(/^pause\s+(?:until|till)\s+(.+)$/);
  if (pauseUntil) {
    return { kind: 'pause', icon: '⏸', label: 'pause', detail: `until ${pauseUntil[1]}` };
  }
  if (/^pause$/.test(s) || /^pause\s+alex$/.test(s)) {
    return { kind: 'pause', icon: '⏸', label: 'pause', detail: 'until you resume' };
  }
  if (/^resume\b/.test(s) || /^unpause\b/.test(s) || /^go\b/.test(s)) {
    return { kind: 'resume', icon: '▶', label: 'resume', detail: 'pick up where I left off' };
  }
  if (/^halt\b/.test(s) || /^stop\b/.test(s)) {
    return { kind: 'halt', icon: '⏹', label: 'halt', detail: 'stop everything now' };
  }
  // follow up with <name> [tonight|tomorrow|at 5|today]
  const fu = s.match(/^(?:fu|follow\s+up)\s+(?:with\s+)?(\w+)(?:\s+(.*))?$/);
  if (fu) {
    return {
      kind: 'followup', icon: '↻',
      label: `follow up · ${cap(fu[1])}`,
      detail: fu[2] ? fu[2] : 'today',
    };
  }
  // brief me at <time>
  const brief = s.match(/^brief(?:\s+me)?(?:\s+at)?\s+(.+)$/);
  if (brief) {
    return { kind: 'brief', icon: '☼', label: 'brief me', detail: `at ${brief[1]}` };
  }
  // stop offering <thing>
  const stopOffer = s.match(/^(?:stop|don'?t)\s+(?:offer(?:ing)?|sending)\s+(.+)$/);
  if (stopOffer) {
    return { kind: 'rule', icon: '⊘', label: 'rule change', detail: `stop offering ${stopOffer[1]}` };
  }
  // reply to <name> myself
  const reply = s.match(/^(?:reply\s+to|i'?ll\s+reply\s+to|let\s+me\s+reply\s+to)\s+(\w+)/);
  if (reply) {
    return { kind: 'handoff', icon: '✎', label: `handoff · ${cap(reply[1])}`, detail: 'you take the thread' };
  }
  // tell alex about <name>
  const tell = s.match(/^tell\s+alex\s+about\s+(\w+)/);
  if (tell) {
    return { kind: 'context', icon: 'ⓘ', label: `context · ${cap(tell[1])}`, detail: 'add a note to the thread' };
  }
  // default — generic instruction
  return { kind: 'instruction', icon: '→', label: 'instruction', detail: raw.length > 60 ? raw.slice(0, 57) + '…' : raw };
}

function fmtTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── ⌘K palette ────────────────────────────────────────────────────
function CommandPalette({ open, onClose, onRun }) {
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (open) {
      setQ('');
      setTimeout(() => inputRef.current && inputRef.current.focus(), 20);
    }
  }, [open]);

  React.useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    if (open) {
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
  }, [open, onClose]);

  if (!open) return null;
  const filtered = window.COMMANDS.filter(c =>
    !q.trim() || c.label.toLowerCase().includes(q.toLowerCase())
  );
  const parsed = q.trim() ? parseCommand(q) : null;

  // group filtered results
  const groups = [];
  for (const c of filtered) {
    let g = groups.find(x => x.id === c.group);
    if (!g) { g = { id: c.group, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  const groupLabel = { control: 'Control Alex', thread: 'Per thread', rules: 'Standing rules', nav: 'Navigate' };

  const T2 = {
    ink: '#0E0C0A', ink3: '#6B6052', ink4: '#A39786',
    hair: 'rgba(14,12,10,0.08)', paper: '#fff', bg: '#FAF8F2',
    amber: '#B8782E', amberSoft: '#F1E2C2',
  };

  return (
    <div onMouseDown={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: 'rgba(14,12,10,0.32)', display: 'grid', placeItems: 'start center',
      paddingTop: 84,
    }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{
        width: 560, maxWidth: 'calc(100% - 32px)', background: T2.paper,
        borderRadius: 10, boxShadow: '0 20px 60px rgba(14,12,10,0.25)',
        overflow: 'hidden', border: `1px solid ${T2.hair}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${T2.hair}` }}>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: T2.ink4, letterSpacing: '0.08em' }}>→ {((window.AGENT && window.AGENT.name) || 'Alex').toUpperCase()}</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const action = parsed || (filtered[0] ? { kind: 'instruction', icon: '→', label: filtered[0].label, detail: '' } : null);
                if (action) { onRun(action); onClose(); }
              }
            }}
            placeholder='Type a command, or tell Alex what to do…'
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'inherit', fontSize: 15, color: T2.ink, padding: '6px 0',
            }}
          />
          <span style={{
            fontFamily: 'JetBrains Mono', fontSize: 10.5, color: T2.ink4,
            padding: '3px 6px', border: `1px solid ${T2.hair}`, borderRadius: 3,
          }}>esc</span>
        </div>
        <div style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 0' }}>
          {parsed && parsed.kind !== 'instruction' && (
            <div style={{ padding: '8px 16px 10px', borderBottom: `1px solid ${T2.hair}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: T2.ink3, textTransform: 'uppercase', marginBottom: 6 }}>From your text</div>
              <button onClick={() => { onRun(parsed); onClose(); }} style={paletteRow(T2, true)}>
                <span style={{ width: 22, color: T2.amber, fontSize: 14, textAlign: 'center' }}>{parsed.icon}</span>
                <span style={{ flex: 1, color: T2.ink, fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600 }}>{parsed.label}</span>
                  {parsed.detail && <span style={{ color: T2.ink3 }}> · {parsed.detail}</span>}
                </span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10.5, color: T2.ink4 }}>↵</span>
              </button>
            </div>
          )}
          {groups.map(g => (
            <div key={g.id} style={{ padding: '8px 16px 6px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: T2.ink3, textTransform: 'uppercase', marginBottom: 4 }}>
                {groupLabel[g.id] || g.id}
              </div>
              {g.items.map(c => (
                <button key={c.id} onClick={() => { onRun({ kind: 'command', icon: '→', label: c.label, detail: '' }); onClose(); }} style={paletteRow(T2, false)}>
                  <span style={{ width: 22, color: T2.ink4, fontSize: 13, textAlign: 'center' }}>·</span>
                  <span style={{ flex: 1, color: T2.ink, fontSize: 13.5 }}>{c.label}</span>
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && !parsed && (
            <div style={{ padding: '20px 16px', color: T2.ink4, fontSize: 13, textAlign: 'center' }}>No matches. Press Enter to send as a free-form instruction.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function paletteRow(T2, highlight) {
  return {
    all: 'unset', display: 'flex', width: '100%', boxSizing: 'border-box',
    alignItems: 'center', gap: 10, padding: '8px 4px', borderRadius: 4,
    cursor: 'pointer',
    background: highlight ? 'rgba(184,120,46,0.06)' : 'transparent',
  };
}

window.parseCommand = parseCommand;
window.CommandPalette = CommandPalette;
