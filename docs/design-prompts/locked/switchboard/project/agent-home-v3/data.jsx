// Data v2 — adds contextual composer suggestions and full thread previews.

const STATES = {
  empty: {
    label: 'Day 1 · just connected',
    statusKey: 'IDLE',
    line: null,
    today: null,
    approval: null,
    activity: [],
    kpis: null,
    narrator: {
      eyebrow: 'Alex · 8 min ago',
      lines: [
        "I'm set up and quiet. Connect Meta Ads and I'll pull the first leads in under a minute.",
        "Then I'll qualify, reply, and book tours under your standing rules. I'll only interrupt you for pricing decisions over $89 and refunds.",
      ],
      nextMove: 'Pull overnight leads from Meta Ads',
    },
    setup: [
      { key: 'meta',   label: 'Connect Meta Ads',                done: false, primary: true,  hint: 'Where leads come from' },
      { key: 'inbox',  label: 'Connect HotPod inbox',            done: false, primary: false, hint: 'Where Alex replies from' },
      { key: 'cal',    label: 'Connect tour calendar',           done: false, primary: false, hint: 'Where bookings land' },
      { key: 'rules',  label: 'Review pricing & escalation',     done: true,  primary: false, hint: 'Pulled from onboarding' },
    ],
    suggestions: [],
  },

  idle: {
    label: 'Idle · quiet morning',
    statusKey: 'IDLE',
    line: 'Quiet morning. No inbound since 7:30. Watching the queue.',
    today: 'Mon May 11',
    approval: null,
    activity: [
      { time: '08:42', kind: 'sent',      head: 'Morning batch · 12 follow-ups', body: 'Dormant Q1 leads who never replied to first touch. Sent under the standard re-engage template.', tag: '+12' },
      { time: '07:14', kind: 'connected', head: 'Pulled 4 new leads from overnight Meta Ads', body: 'Campaign: HotPod Tours · Bay Area. CTR 2.1%. All four match the warm-lead filter.', tag: '+4' },
      { time: '07:00', kind: 'started',   head: 'Daily run begins', body: 'Quiet hours end at 9 AM. No outbound before then.' },
      { time: 'Fri',   kind: 'booked',    head: 'Maya R. confirmed Saturday 10 AM tour', body: 'Calendar held. First-timer note added.', who: 'Maya R.',
        preview: [
          { from: 'Alex',   text: "Hey Maya — I've got Saturday 10 AM open for the tour. Want me to hold it?" },
          { from: 'Maya R.',text: "Yes please! See you at 10 — should I bring anything?" },
          { from: 'Alex',   text: "Just yourself. We'll have water and a mat ready." },
        ] },
      { time: 'Fri',   kind: 'qualified', head: 'Jordan F. asked about 6-month pricing', body: 'Long-term intent. Pinned for Monday so you can decide on the founding rate.', who: 'Jordan F.' },
    ],
    kpis: {
      range: 'This week · May 5 — 11',
      booked: 6, bookedDelta: '+2 vs last',
      leads: 38, leadsDelta: '+11',
      qualifiedPct: 22, qualifiedDelta: '+3 pts',
      spend: 142, avgValue: 179, target: 30,
    },
    suggestions: [
      'Resume the dormant Q1 batch',
      'Brief me at noon',
      'Pause until 3 PM',
    ],
  },

  approval: {
    label: 'Approval pending',
    statusKey: 'WAITING',
    line: 'Replying to Priya. Holding on Jordan until you decide.',
    today: 'Mon May 11',
    approval: {
      askedAt: '4 min ago',
      title: 'Send Jordan the founding-member rate?',
      body: 'Alex wants to offer $89/mo on a 6-month — your founding rate, normally $119. Jordan asked the long-term price twice and went quiet for fourteen minutes.',
      quote: "I'm honestly in if the price is right. What's the best you can do on a 6-month?",
      quoteFrom: 'Jordan F. · 11:53',
      primary: 'Accept & send',
      secondary: 'Decline',
    },
    activity: [
      { time: '11:57', kind: 'waiting',   head: 'Awaiting your call on Jordan F. pricing reply', body: 'Holding the thread. Will not send anything until you accept or decline above.' },
      { time: '11:53', kind: 'replied',   head: 'Jordan F. pushed back on standard pricing', body: 'Asked for the long-term rate. Twice. This is the moment.', who: 'Jordan F.',
        preview: [
          { from: 'Alex',     text: "Happy to send pricing — standard is $119/mo, or $99 on annual. Want the link?" },
          { from: 'Jordan F.',text: "What about longer commitments? I'm thinking 6 months." },
          { from: 'Alex',     text: "On 6-month I'd usually point you to annual — better value per month." },
          { from: 'Jordan F.',text: "I'm honestly in if the price is right. What's the best you can do on a 6-month?" },
        ] },
      { time: '11:42', kind: 'booked',    head: 'Maya R. confirmed Saturday 10 AM tour', body: 'Calendar held. First-timer note added to her record.', who: 'Maya R.' },
      { time: '11:18', kind: 'qualified', head: 'Priya M. — evening classes, intent matched', body: 'Looking for Wed/Thu after 6 PM. Drafted reply with two slots.', who: 'Priya M.' },
      { time: '10:55', kind: 'replied',   head: 'Tom W. — answered cancellation questions', body: 'Walked through 24-hour policy and the founder-rate hold rule.', who: 'Tom W.' },
      { time: '09:30', kind: 'escalated', head: 'Refund request from Avi R. → your inbox', body: 'Above $50 threshold. Did not touch — sent the full thread to you.', who: 'Avi R.' },
      { time: '08:42', kind: 'sent',      head: 'Morning batch · 12 follow-ups', body: 'Dormant Q1 leads.', tag: '+12' },
    ],
    kpis: {
      range: 'This week · May 5 — 11',
      booked: 9, bookedDelta: '+3',
      leads: 47, leadsDelta: '+12',
      qualifiedPct: 28, qualifiedDelta: '+4 pts',
      spend: 214, avgValue: 179, target: 30,
    },
    suggestions: [
      'Hold Jordan, I\u2019ll reply myself',
      'Decline & stop offering the founder rate',
      'Pause new threads for 30 min',
    ],
  },

  busy: {
    label: 'Busy · 3 live',
    statusKey: 'TALKING',
    liveCount: 3,
    line: 'Talking to three people. Two warm. One on pricing — covered by your standing rule.',
    today: 'Mon May 11',
    approval: null,
    activity: [
      { time: '11:58', kind: 'replied',   head: 'Devon K. asking about first-timer pricing', body: 'Drafting reply with the intro-rate link.', who: 'Devon K.' },
      { time: '11:55', kind: 'replied',   head: 'Priya M. picked Wednesday 6 PM evening class', body: 'Confirming the slot and sending the studio address.', who: 'Priya M.' },
      { time: '11:52', kind: 'replied',   head: 'Casey H. asking about parking', body: 'Answered — holding for response on tour time.', who: 'Casey H.' },
      { time: '11:42', kind: 'booked',    head: 'Maya R. confirmed Saturday 10 AM tour', body: 'Calendar held.', who: 'Maya R.' },
      { time: '11:38', kind: 'replied',   head: 'Jordan F. — sent founding-member offer', body: 'Standing rule covered this. No approval needed.', who: 'Jordan F.' },
      { time: '11:05', kind: 'booked',    head: 'Devon K. — Sunday 9 AM. First-timer note added.', who: 'Devon K.' },
      { time: '10:48', kind: 'qualified', head: 'Avi R. re-engaged after 14 days cold', who: 'Avi R.' },
      { time: '10:30', kind: 'passed',    head: 'Kai T. — out of region. Politely closed.', who: 'Kai T.' },
      { time: '09:18', kind: 'escalated', head: 'Tom W. cancellation → your inbox', who: 'Tom W.' },
      { time: '08:42', kind: 'sent',      head: 'Morning batch · 12 follow-ups', tag: '+12' },
    ],
    kpis: {
      range: 'Today',
      booked: 11, bookedDelta: 'best Mon',
      leads: 47, leadsDelta: '+12',
      qualifiedPct: 31, qualifiedDelta: '+6 pts',
      spend: 214, avgValue: 179, target: 30,
    },
    suggestions: [
      'Hold all replies for 10 min',
      'Highlight Devon — first-timer',
      'Stop offering the founder rate',
    ],
  },
};

// Command palette catalog — actions reachable from ⌘K
const COMMANDS = [
  { id: 'pause-1h',     label: 'Pause Alex for 1 hour',          group: 'control' },
  { id: 'pause-3pm',    label: 'Pause until 3 PM',               group: 'control' },
  { id: 'resume',       label: 'Resume Alex',                    group: 'control' },
  { id: 'halt',         label: 'Halt — stop everything',         group: 'control' },
  { id: 'brief-noon',   label: 'Brief me at noon',               group: 'control' },
  { id: 'brief-eod',    label: 'Brief me at end of day',         group: 'control' },
  { id: 'fu-maya',      label: 'Follow up with Maya tonight',    group: 'thread' },
  { id: 'fu-jordan',    label: 'Reply to Jordan myself',         group: 'thread' },
  { id: 'hold-jordan',  label: 'Hold Jordan, don\u2019t send anything', group: 'thread' },
  { id: 'stop-founder', label: 'Stop offering the founder rate', group: 'rules' },
  { id: 'raise-rule',   label: 'Raise approval threshold to $99', group: 'rules' },
  { id: 'open-settings',label: 'Open settings',                  group: 'nav' },
  { id: 'open-rules',   label: 'Open standing rules',            group: 'nav' },
  { id: 'open-meta',    label: 'Open Meta Ads campaigns',        group: 'nav' },
];

window.STATES = STATES;
window.COMMANDS = COMMANDS;
