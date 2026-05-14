// Riley data — same schema as Alex's data.jsx. Diff = different states + tiles.
//
// STATES:
//   cold   — Meta Ads not connected. KPIs all unavailable, ROI bar degraded,
//            approvals absent, activity shows connection prompts.
//   steady — connected, 2 approvals pending, full ROI + activity.

const STATES = {
  cold: {
    label: 'Cold start · Meta not connected',
    statusKey: 'IDLE',
    line: 'No ad platform connected yet. Once Meta Ads is in, I\'ll start scoring ad sets every 10 minutes.',
    today: 'Mon May 11',
    approval: null,
    activity: [
      { time: '\u2014', kind: 'alert',    head: 'Connect Meta Ads to begin', body: 'I read campaign performance from Meta, score each ad set against your target CPL, and recommend pause / reduce / scale / rotate actions for you to approve.' },
      { time: '\u2014', kind: 'alert',    head: 'Set average lead value', body: 'Without this, I can show CPL but not ROAS. Two minutes in Settings \u2192 Targets.' },
      { time: '\u2014', kind: 'started',  head: 'Standing rules loaded', body: 'Pause threshold, scale guardrails, rotation cadence \u2014 all carried over from onboarding.' },
    ],
    filters: ['all'],
    kpis: {
      range: 'This week',
      tiles: [
        { label: 'leads',     value: '\u2014', unavailable: true, hint: 'Connect Meta Ads' },
        { label: 'spend',     value: '\u2014', unavailable: true, hint: 'Connect Meta Ads' },
        { label: 'CPL',       value: '\u2014', unavailable: true, hint: 'Connect Meta Ads' },
        { label: 'ROAS',      value: '\u2014', unavailable: true, hint: 'Set avg lead value' },
      ],
      roi: {
        label: 'return on ad spend',
        degraded: true,
        degradedHint: 'Connect Meta Ads to see ROAS',
        comparator: { value: 'CPL \u2014', target: 'target $25' },
      },
    },
    suggestions: [
      'Open Meta Ads connector',
      'Set target CPL to $25',
      'Set average lead value',
    ],
  },

  steady: {
    label: 'Steady · 2 approvals',
    statusKey: 'WAITING',
    line: 'Three ad sets need a decision today. Spring Sale is leaking; Retargeting creative is fatigued; Lookalike 1% wants more room.',
    today: 'Mon May 11',
    approval: [
      {
        id: 'pause-spring',
        askedAt: '7 min ago',
        title: 'Pause adset',
        campaign: { name: 'Spring Sale \u2014 Awareness' },
        quote: 'CPL $42 vs $25 target for 3 days. Spend $680 at risk this week.',
        risk: '$680 at risk',
        primary: 'Pause adset',
        secondary: 'Decline',
        presentation: { primaryLabel: 'Pause adset', dismissLabel: 'Decline' },
        acceptToast: 'Paused Spring Sale \u2014 Awareness. Holding the budget on Lookalike 1%.',
        declineToast: 'Holding. I\u2019ll re-score this set tomorrow morning.',
      },
      {
        id: 'rotate-retarget',
        askedAt: '23 min ago',
        title: 'Rotate creative',
        campaign: { name: 'Retargeting \u2014 Hot' },
        quote: 'CTR down 38% over 5 days; same creative live 14 days. Three fresh variants ready in your library.',
        risk: '$310/wk at current trajectory',
        primary: 'Rotate creative',
        secondary: 'Decline',
        presentation: { primaryLabel: 'Rotate creative', dismissLabel: 'Decline' },
        acceptToast: 'Rotating to variant set B. I\u2019ll re-score CTR in 48 hours.',
        declineToast: 'Sticking with the current creative. Will flag again if CTR drops another 10%.',
      },
      {
        id: 'scale-lal1',
        askedAt: '1 hr ago',
        title: 'Scale budget',
        campaign: { name: 'Lookalike 1%' },
        quote: 'ROAS 3.2\u00d7 sustained for 7 days; running under your daily cap. Suggest +$40/day.',
        risk: 'Upside: ~6 extra leads/wk',
        primary: 'Scale +$40/day',
        secondary: 'Decline',
        presentation: { primaryLabel: 'Scale +$40/day', dismissLabel: 'Decline' },
        acceptToast: 'Raised Lookalike 1% daily budget by $40. Watching the next 3 days.',
        declineToast: 'Holding the cap. I\u2019ll re-propose if ROAS stays above 3\u00d7 for another week.',
      },
    ],
    activity: [
      { time: '11:58', kind: 'reviewing', head: 'Scoring 3 ad sets\u2026', body: 'Running the 10-minute pass over yesterday\u2019s performance.' },
      { time: '09:14', kind: 'watching',  head: 'Paused "Spring Sale \u2014 Reach" \u2014 budget exhausted', body: 'Daily budget cap hit at 09:12. Reach campaign is set to auto-pause on exhaustion.' },
      { time: '08:46', kind: 'watching',  head: 'Scaled "Lookalike 1%" by 18%', body: 'Standing rule covered this (ROAS \u2265 3\u00d7 for 5 days, under cap).' },
      { time: '08:12', kind: 'shifted',   head: 'Shifted $60/day from "Cold Interests" to "Lookalike 1%"', body: 'Cold Interests CPL trended above target for 4 of 5 days. Lookalike was under-spending.' },
      { time: '07:00', kind: 'started',   head: 'Daily scan begins', body: 'Quiet hours end at 7 AM. No outbound changes before then.' },
      { time: 'Fri',   kind: 'alert',     head: 'Meta Ads token expiring in 4 days \u2014 reconnect', body: 'Token expires Friday at midnight. Reconnect from Settings \u2192 Channels to avoid a gap.' },
    ],
    filters: ['all', 'approvals', 'changes'],
    kpis: {
      range: 'This week · May 5 — 11',
      tiles: [
        { label: 'leads',     value: 47,     trend: '+9 vs last' },
        { label: 'spend',     value: '$684' },
        { label: 'CPL',       value: '$28',  unit: '',  trend: '\u2212$3 vs last' },
        { label: 'ROAS',      value: '1.6',  unit: '\u00d7', trend: '+0.2 vs last' },
      ],
      roi: {
        label: 'return on ad spend',
        leftMeta: '$684 spent',
        rightMeta: { value: '$1,094', suffix: ' in lead value' },
        fillPct: (1.6 / 4) * 100,  // 1.6× of 4× scale
        breakEvenPct: (1 / 4) * 100,
        breakEvenLabel: '1\u00d7 break-even',
        scaleLeft: '0\u00d7',
        scaleRight: '4\u00d7 spend',
        comparator: { value: 'CPL $28', target: 'target $25', onTarget: false },
      },
    },
    suggestions: [
      'Pause all Spring Sale ad sets',
      'Brief me at end of day',
      'Raise target CPL to $30 for this week',
    ],
  },
};

// Riley-flavored command palette catalog.
const COMMANDS = [
  { id: 'pause-spring',  label: 'Pause Spring Sale ad sets',           group: 'control' },
  { id: 'pause-1h',      label: 'Pause Riley for 1 hour',              group: 'control' },
  { id: 'resume',        label: 'Resume Riley',                        group: 'control' },
  { id: 'brief-eod',     label: 'Brief me at end of day',              group: 'control' },
  { id: 'scale-lal',     label: 'Scale Lookalike 1% by $40/day',       group: 'thread' },
  { id: 'rotate-retar',  label: 'Rotate Retargeting creative',         group: 'thread' },
  { id: 'cpl-30',        label: 'Raise target CPL to $30',             group: 'rules' },
  { id: 'no-scale',      label: 'Stop auto-scaling ad sets',           group: 'rules' },
  { id: 'open-meta',     label: 'Open Meta Ads campaigns',             group: 'nav' },
  { id: 'open-rules',    label: 'Open standing rules',                 group: 'nav' },
  { id: 'open-targets',  label: 'Open targets · CPL · lead value',     group: 'nav' },
];

window.STATES = STATES;
window.COMMANDS = COMMANDS;
