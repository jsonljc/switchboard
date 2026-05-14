// /mission fixtures — operator's cross-agent command center.
// Realistic Singapore medspa operator data, mirroring the shapes from
// useDashboardOverview / useAgentRoster / useDecisionFeed / useRecommendations.

window.MISSION_DATA = (function () {

  // ── Greeting + pulse ────────────────────────────────────────────
  const greeting = {
    period: 'morning',
    operatorName: 'Jason',
    fetchedAt: '4 min ago',
    fetchedAtIso: '08:42 SGT',
  };

  const pulse = {
    pendingApprovals: 3,
    overdueTasks: 2,
    newInquiriesToday: 7,
    newInquiriesYesterday: 5,
    bookingsToday: 4,
  };

  // ── Agents (3) ──────────────────────────────────────────────────
  const agents = [
    {
      id: 'alex',
      displayName: 'Alex',
      role: 'SDR · qualifying inbound',
      activityStatus: 'working',
      tier: 'alex',
      currentTask: 'Qualifying 3 leads from Meta Ads',
      lastActionSummary: 'Booked Priya for HydraFacial tour — Thu 4pm',
      lastActionAt: '2m',
      metrics: { working: 3, queued: 1 },
      halted: false,
    },
    {
      id: 'riley',
      displayName: 'Riley',
      role: 'Ads · campaign operator',
      activityStatus: 'idle',
      tier: 'riley',
      currentTask: 'Watching · next check 11:00 SGT',
      lastActionSummary: 'Rotated tired creative on “Skin Reset” set',
      lastActionAt: '47m',
      metrics: { working: 0, queued: 0 },
      halted: false,
    },
    {
      id: 'mira',
      displayName: 'Mira',
      role: 'Retention · WhatsApp follow-ups',
      activityStatus: 'waiting',
      tier: 'mira',
      currentTask: 'Waiting on your approval — re-engagement copy',
      lastActionSummary: 'Drafted 14-day follow-up sequence',
      lastActionAt: '12m',
      metrics: { working: 0, queued: 2 },
      halted: false,
    },
  ];

  // ── Queue (9 items, unified card shape) ─────────────────────────
  // Each: type ∈ {approval|task|rec}, risk, summary, agent, meta, age, dueOrExpiry
  const queue = [
    // ── Approvals (4, risk-spanning) ──
    {
      kind: 'approval',
      id: 'apv-7K4M',
      risk: 'critical',
      summary: 'Approve S$2,400 ad spend reallocation — pull from “Botox starter” into “Skin Reset”',
      agent: 'riley',
      hashShort: 'H:7k4m·c2e1',
      campaign: 'Reallocation · Meta',
      ageLabel: 'asked 6m ago',
      expiryLabel: 'expires in 1h 02m',
      expiryState: 'warn',
      detail: 'Skin Reset CPL down 38% the last 48h. Botox starter flat. Quorum: you + finance.',
      primary: 'Review & confirm',
    },
    {
      kind: 'approval',
      id: 'apv-9L2A',
      risk: 'high',
      summary: 'Approve discount — 15% off first HydraFacial for Priya T. (price guard)',
      agent: 'alex',
      hashShort: 'H:9l2a·44d8',
      campaign: 'Pricing override',
      ageLabel: 'asked 12m ago',
      expiryLabel: '38m left',
      expiryState: 'warn',
      detail: 'Priya asked for first-visit promo. Above standard 10% guard, below 20% ceiling.',
      primary: 'Approve · S$144',
    },
    {
      kind: 'approval',
      id: 'apv-3T8X',
      risk: 'medium',
      summary: 'Send re-engagement WhatsApp to 38 lapsed clients (90+ days quiet)',
      agent: 'mira',
      hashShort: 'H:3t8x·9a11',
      campaign: 'Retention · WA broadcast',
      ageLabel: 'asked 14m ago',
      expiryLabel: '2h 18m left',
      expiryState: '',
      detail: 'Segment ≤ template limits. Copy stays inside approved offer ladder.',
      primary: 'Review batch',
    },
    {
      kind: 'approval',
      id: 'apv-Q11R',
      risk: 'low',
      summary: 'Auto-reply tone shift — switch Alex to “warmer” after-hours (test, 24h)',
      agent: 'alex',
      hashShort: 'H:q11r·001f',
      campaign: 'Voice · A/B',
      ageLabel: 'asked 41m ago',
      expiryLabel: '5h 12m left',
      expiryState: '',
      detail: 'Reversible. Stays inside brand voice guidelines doc.',
      primary: 'Approve trial',
    },
    // ── Owner tasks (3, 1 overdue) ──
    {
      kind: 'task',
      id: 'task-1188',
      risk: 'high',
      summary: 'Confirm Dr Lim is on-floor Friday before Riley reopens “Skin Reset” budget',
      agent: null,
      ageLabel: 'created Tue',
      expiryLabel: 'overdue · 1d',
      expiryState: 'critical',
      overdue: true,
      detail: 'Riley is waiting on this to scale spend ≥ S$1,200/day.',
      primary: 'Mark done',
    },
    {
      kind: 'task',
      id: 'task-1192',
      risk: 'medium',
      summary: 'Approve new tour-confirmation template (Alex flagged 2 typos last week)',
      agent: null,
      ageLabel: 'created yesterday',
      expiryLabel: 'overdue · 4h',
      expiryState: 'critical',
      overdue: true,
      detail: 'Draft is in /content. Alex will use immediately on approve.',
      primary: 'Open draft',
    },
    {
      kind: 'task',
      id: 'task-1207',
      risk: 'low',
      summary: 'Add Yvonne (new aesthetician) to staff roster + Telegram broadcast group',
      agent: null,
      ageLabel: 'created 2h ago',
      expiryLabel: 'due Fri',
      expiryState: '',
      detail: 'No agent depends on this yet. Heads-up only.',
      primary: 'Mark done',
    },
    // ── Recommendations (2) ──
    {
      kind: 'rec',
      id: 'rec-22A',
      risk: 'medium',
      summary: 'Riley suggests: pause “Botox starter” adset for 24h — CPL drifted above ceiling',
      agent: 'riley',
      ageLabel: 'drafted 8m ago',
      expiryLabel: 'undo window 6h',
      expiryState: '',
      detail: 'Adset 0042 · CPL S$48 vs ceiling S$32. Yesterday: S$31. Reversible.',
      primary: 'Accept',
    },
    {
      kind: 'rec',
      id: 'rec-22B',
      risk: 'low',
      summary: 'Alex suggests: bump tour-confirm reminder from 24h to 6h ahead — no-shows up 2%',
      agent: 'alex',
      ageLabel: 'drafted 23m ago',
      expiryLabel: 'undo window 6h',
      expiryState: '',
      detail: 'Tested previously in March — no-show rate fell 4%. Reversible.',
      primary: 'Accept',
    },
  ];

  // ── Funnel ──────────────────────────────────────────────────────
  const funnel = [
    { key: 'inquiry',   label: 'inquiry',   count: 200 },
    { key: 'qualified', label: 'qualified', count:  80 },
    { key: 'booked',    label: 'booked',    count:  35 },
    { key: 'purchased', label: 'purchased', count:  24 },
    { key: 'completed', label: 'completed', count:  18 },
  ];

  // ── Revenue ─────────────────────────────────────────────────────
  const revenue = {
    totalLabel: 'S$14,720',
    rangeLabel: 'last 7 days',
    count: 24,
    countLabel: '24 paid visits',
    topSource: 'HydraFacial · 11 of 24',
  };

  // ── Bookings today ──────────────────────────────────────────────
  const bookings = [
    { id: 'b-44', startsAt: '10:30', service: 'HydraFacial',       contactName: 'Priya T.',      status: 'confirmed', channel: 'wa'   },
    { id: 'b-45', startsAt: '12:00', service: 'Consultation',      contactName: 'Marcus L.',     status: 'confirmed', channel: 'tg'   },
    { id: 'b-46', startsAt: '15:15', service: 'Botox · top-up',    contactName: 'Aisha R.',      status: 'confirmed', channel: 'dash' },
    { id: 'b-47', startsAt: '17:45', service: 'Skin Reset · tour', contactName: 'Wei Lin',       status: 'tentative', channel: 'wa'   },
  ];

  // ── Activity tail (last 8) ──────────────────────────────────────
  const activity = [
    { time: '08:38', actor: 'AGT', actorAgent: 'alex',  summary: 'Booked Priya T. — HydraFacial · Thu 4pm' },
    { time: '08:31', actor: 'AGT', actorAgent: 'mira',  summary: 'Drafted re-engagement WA copy · 38 recipients' },
    { time: '08:14', actor: 'USR', actorAgent: null,     summary: 'Jason resolved task · review Sept invoice batch' },
    { time: '07:55', actor: 'AGT', actorAgent: 'riley', summary: 'Rotated creative on Skin Reset · adset 0114' },
    { time: '07:42', actor: 'AGT', actorAgent: 'alex',  summary: 'Replied to 4 new inquiries from Meta Ads' },
    { time: '07:30', actor: 'SYS', actorAgent: null,     summary: 'Daily envelope sealed · 02:00 SGT · hash 8f2c…' },
    { time: 'Tue',   actor: 'USR', actorAgent: null,     summary: 'Jason approved Riley · 24h budget ceiling raise' },
    { time: 'Tue',   actor: 'AGT', actorAgent: 'riley', summary: 'Paused Botox starter adset · CPL > ceiling' },
  ];

  return {
    greeting, pulse, agents, queue,
    funnel, revenue, bookings, activity,
  };
})();
