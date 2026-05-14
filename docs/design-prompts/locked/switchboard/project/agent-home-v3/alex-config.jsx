// Agent identity for Alex — runs before cockpit.jsx so window.AGENT is set.
// Diff this against riley-config.jsx to see the per-agent surface area.

window.AGENT = {
  name: 'Alex',
  variants: window.ALEX_VARIANTS,
  accent: {
    base:  '#B8782E',   // warm amber (shared with approval color for Alex)
    deep:  '#7C4F1C',
    soft:  '#F1E2C2',
    paper: '#FBF1D6',
  },
  tabs: [
    { name: 'Alex', active: true },
    { name: 'Riley' },
    { name: 'Mira', muted: true },
  ],
  statusColor: (key, halted) => halted
    ? '#A03A2E'
    : key === 'TALKING' ? '#3F7A36'
    : key === 'WAITING' ? '#B8782E'
    : '#A39786',
  statusPulse: (key, halted) => !halted && (key === 'TALKING' || key === 'WAITING'),
  animState: (key, halted) => halted
    ? 'sleep'
    : key === 'TALKING' || key === 'WAITING' ? 'draft'
    : 'idle',
  mission: {
    subtitle: 'SDR · Tours pipeline · HotPod',
    title: 'What is Alex configured for?',
    rows: [
      ['ROLE',     'SDR · qualify inbound leads, book tours'],
      ['PIPELINE', 'Tours pipeline · single funnel'],
      ['BRAND',    'HotPod · Bay Area studio'],
      ['CHANNELS', 'Meta Ads · HotPod inbox · tour calendar'],
    ],
  },
  composerPlaceholder: 'Tell Alex what to do — "pause an hour", "follow up with Maya tonight"…',
  needsYouLabel: 'Alex needs you',
  // toast voice — keep Alex's first-person SDR phrasing
  toastVoice: (action) =>
      (action.kind === 'pause')     ? `Paused — ${action.detail}.`
    : (action.kind === 'resume')    ? `Resumed. Picking up where I left off.`
    : (action.kind === 'halt')      ? `Halted. Nothing going out until you resume.`
    : (action.kind === 'followup')  ? `${action.label} — I'll handle it ${action.detail}.`
    : (action.kind === 'brief')     ? `I'll brief you ${action.detail}.`
    : (action.kind === 'rule')      ? `Rule updated — ${action.detail}.`
    : (action.kind === 'handoff')   ? `Handed off. The thread is yours.`
    : (action.kind === 'context')   ? `Noted. I'll factor that in next time we talk to them.`
    : (action.kind === 'command')   ? `On it — ${action.label.toLowerCase()}.`
    : `Got it. Acting on "${action.detail || action.label}".`,

  // Canvas presentation
  canvas: {
    title: 'Alex — cockpit v3 · refined',
    subtitle: '⌘K palette · NL-parsed composer · ROI bar · Day-1 narrator · inline thread + reply · pixel avatar · tappable mission',
    bg: '#ECE7DA',
    states: [
      { key: 'empty',    label: 'Day 1 · just connected', desktopHeight: 900,  mobileHeight: 1200 },
      { key: 'idle',     label: 'Idle · quiet morning',   desktopHeight: 1120, mobileHeight: 1480 },
      { key: 'approval', label: 'Approval pending',       desktopHeight: 1120, mobileHeight: 1480 },
      { key: 'busy',     label: 'Busy · 3 live',          desktopHeight: 1240, mobileHeight: 1640 },
    ],
    variantOptions: [
      { value: 'classic',  label: 'Classic' },
      { value: 'operator', label: 'Operator' },
      { value: 'cozy',     label: 'Cozy' },
      { value: 'agent',    label: 'Agent' },
    ],
  },
};
