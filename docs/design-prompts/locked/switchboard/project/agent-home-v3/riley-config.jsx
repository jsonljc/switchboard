// Agent identity for Riley — diff against alex-config.jsx.
// Same surface area; only data, copy, and accent color change.

window.AGENT = {
  name: 'Riley',
  variants: window.RILEY_VARIANTS,
  accent: {
    base:  '#B86C50',   // warm clay  hsl(15 45% 50%)
    deep:  '#7E4533',
    soft:  '#ECD4C8',
    paper: '#F6E7DE',
  },
  tabs: [
    { name: 'Alex' },
    { name: 'Riley', active: true },
    { name: 'Mira', muted: true },
  ],
  // Riley state pills: WATCHING (steady green), REVIEWING (transient amber pulse),
  // WAITING (approval pending amber), IDLE (no channel connected), HALTED.
  statusColor: (key, halted) => halted
    ? '#A03A2E'
    : key === 'WATCHING'  ? '#3F7A36'
    : key === 'REVIEWING' ? '#B8782E'
    : key === 'WAITING'   ? '#B8782E'
    : key === 'IDLE'      ? '#A39786'
    : '#A39786',
  statusPulse: (key, halted) => !halted && key === 'REVIEWING',
  animState: (key, halted) => halted
    ? 'sleep'
    : key === 'WATCHING'  ? 'idle'
    : key === 'REVIEWING' ? 'draft'
    : key === 'WAITING'   ? 'draft'
    : 'idle',
  mission: {
    subtitle: 'Optimizing Meta Ads for HotPod',
    title: 'What is Riley configured for?',
    rows: [
      ['ROLE',     'Ad optimizer · score, pause, scale, rotate'],
      ['PIPELINE', 'Ad sets · all campaigns'],
      ['BRAND',    'HotPod · Bay Area studio'],
      ['CHANNELS', 'Meta Ads', 'ok'],
    ],
  },
  composerPlaceholder: 'Tell Riley what to do — "pause the Cold Interests adset", "raise daily budget to $200"…',
  needsYouLabel: 'Riley needs you',
  toastVoice: (action) =>
      (action.kind === 'pause')     ? `Paused — ${action.detail}.`
    : (action.kind === 'resume')    ? `Back on. Resuming the scan.`
    : (action.kind === 'halt')      ? `Halted. No changes will be made until you resume.`
    : (action.kind === 'rule')      ? `Rule updated — ${action.detail}.`
    : (action.kind === 'brief')     ? `I'll brief you ${action.detail}.`
    : (action.kind === 'command')   ? `On it — ${action.label.toLowerCase()}.`
    : `Got it. Acting on "${action.detail || action.label}".`,

  canvas: {
    title: 'Riley — cockpit v3 · refined',
    subtitle: 'Same shell as Alex. Data, copy, accent (warm clay) change. Two states: cold start (Meta not connected) and steady (2 approvals).',
    bg: '#ECE7DA',
    states: [
      { key: 'cold',   label: 'Cold start · Meta not connected', desktopHeight: 900,  mobileHeight: 1100 },
      { key: 'steady', label: 'Steady · 2 approvals',            desktopHeight: 1320, mobileHeight: 1740 },
    ],
    variantOptions: [
      { value: 'analyst',  label: 'Analyst' },
      { value: 'terminal', label: 'Terminal' },
      { value: 'agent',    label: 'Agent' },
    ],
  },
};
