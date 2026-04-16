export interface AgentContent {
  tagline: string;
  capabilities: string[];
  howItWorks: { step: string; label: string; body: string }[];
  channels: { name: string; icon: string }[];
  trustNote: string;
  faq: { q: string; a: string }[];
}

export const AGENT_CONTENT: Record<string, AgentContent> = {
  "speed-to-lead": {
    tagline:
      "Responds to every new lead in under 5 minutes — so you never lose a hot prospect to slow follow-up.",
    capabilities: [
      "Greets every new inbound lead within minutes, 24 hours a day",
      "Qualifies prospects with a short conversation — budget, timing, fit",
      "Books discovery calls directly into your calendar",
      "Escalates high-priority leads to a human when the moment demands it",
    ],
    howItWorks: [
      {
        step: "01",
        label: "Lead comes in",
        body: "A new contact fills out a form, sends a DM, or clicks your widget. Speed-to-Lead picks it up instantly.",
      },
      {
        step: "02",
        label: "Qualify the conversation",
        body: "The agent asks 3–4 natural questions to understand fit, budget, and urgency — no interrogation, just good listening.",
      },
      {
        step: "03",
        label: "Book or hand off",
        body: "Qualified leads get a calendar link. Hot ones get flagged for you immediately. Everything is logged.",
      },
    ],
    channels: [
      { name: "WhatsApp", icon: "💬" },
      { name: "Telegram", icon: "✈️" },
      { name: "Web widget", icon: "🌐" },
    ],
    trustNote:
      "Starts supervised — every booking reviewed by you. As it proves itself, it earns the right to book independently.",
    faq: [
      {
        q: "What happens if a lead asks something the agent can't handle?",
        a: "It flags the conversation for you and holds warmly until you step in. No lead falls through the cracks.",
      },
      {
        q: "Can it book into my existing calendar?",
        a: "Yes — it integrates with Google Calendar and Calendly. You control which slots it can offer.",
      },
      {
        q: "How fast does it really respond?",
        a: "Under 5 minutes for any new lead, any time of day. Most responses are much faster.",
      },
      {
        q: "What if I want to review its conversations?",
        a: "Every conversation is logged with full transcript. You can review, approve, or correct at any time.",
      },
    ],
  },
  "sales-closer": {
    tagline:
      "Keeps warm prospects engaged until they're ready to buy — so nothing falls out of your pipeline.",
    capabilities: [
      "Follows up with prospects who've gone quiet — at the right time, with the right tone",
      "Sends personalised check-ins based on where each lead is in the pipeline",
      "Surfaces objections early so you can address them before they kill the deal",
      "Knows when to back off and when to push — based on conversation signals",
    ],
    howItWorks: [
      {
        step: "01",
        label: "Prospect enters the pipeline",
        body: "Sales Closer picks up any lead that hasn't converted yet — from your CRM or wherever you track them.",
      },
      {
        step: "02",
        label: "Timed, personalised follow-up",
        body: "It sends a message at the right moment — not a spammy sequence, but a thoughtful nudge based on timing and context.",
      },
      {
        step: "03",
        label: "Move the deal forward",
        body: "Objections get surfaced. Interested prospects get booked. Quiet ones get re-engaged. You focus on the conversations worth having.",
      },
    ],
    channels: [
      { name: "WhatsApp", icon: "💬" },
      { name: "Telegram", icon: "✈️" },
      { name: "Email", icon: "📧" },
    ],
    trustNote:
      "Starts with you approving every follow-up. As you build confidence, it handles routine nudges independently.",
    faq: [
      {
        q: "Will it come across as spammy?",
        a: "No — it's trained to be direct and respectful, not pushy. You can review its tone before it sends anything.",
      },
      {
        q: "Can I set how often it follows up?",
        a: "Yes. You control the cadence, the channels, and the intensity. It adapts based on prospect engagement.",
      },
      {
        q: "Does it work with my existing CRM?",
        a: "It reads pipeline state from your CRM. Native integrations are in active development — ask us about your stack.",
      },
      {
        q: "What if a prospect asks to stop hearing from us?",
        a: "It honours unsubscribe requests immediately and logs the opt-out.",
      },
    ],
  },
  "nurture-specialist": {
    tagline: "Keeps your audience warm between purchases — so they come back when they're ready.",
    capabilities: [
      "Sends personalised check-ins that feel human, not automated",
      "Celebrates wins, asks for feedback, and stays top of mind without being annoying",
      "Identifies re-engagement opportunities in your existing contacts",
      "Surfaces loyal customers who might be ready for an upsell conversation",
    ],
    howItWorks: [
      {
        step: "01",
        label: "Know your contacts",
        body: "Nurture Specialist learns who your contacts are — past purchases, engagement history, preferences — and builds a picture over time.",
      },
      {
        step: "02",
        label: "Stay present, not pushy",
        body: "It sends the kind of messages people actually appreciate: a check-in after a purchase, a relevant tip, a quiet 'how's it going?'",
      },
      {
        step: "03",
        label: "Surface the right moment",
        body: "When a contact shows buying signals — engagement spikes, a question, a milestone — it flags them for you or moves them into an active sales flow.",
      },
    ],
    channels: [
      { name: "WhatsApp", icon: "💬" },
      { name: "Telegram", icon: "✈️" },
      { name: "Web widget", icon: "🌐" },
    ],
    trustNote:
      "Every message is reviewable. As trust builds, it handles routine nurture independently — you focus on the moments that matter.",
    faq: [
      {
        q: "How is this different from email marketing?",
        a: "It's conversational — two-way, personalised, and responsive. Not a broadcast. People can reply, ask questions, and get real answers.",
      },
      {
        q: "Can it handle a list of 1,000 contacts?",
        a: "Yes — it prioritises based on engagement signals and works through your list intelligently, not all at once.",
      },
      {
        q: "What if a contact wants to speak to a human?",
        a: "It hands off immediately, with full context so you don't have to start from scratch.",
      },
      {
        q: "Can I set the tone and voice?",
        a: "Yes. You can set how formal or casual it should be, and review its messages until you're comfortable with its style.",
      },
    ],
  },
};

export const FALLBACK_CONTENT: AgentContent = {
  tagline:
    "An AI agent built to handle your growth work — reliably, consistently, and on your terms.",
  capabilities: [
    "Handles routine tasks so you can focus on the work only you can do",
    "Works across your preferred channels — WhatsApp, Telegram, or your website",
    "Every action is logged and reviewable at any time",
    "Earns autonomy through performance — starts careful, grows confident",
  ],
  howItWorks: [
    {
      step: "01",
      label: "Browse and choose",
      body: "Find the agent that fits your use case. Every agent is purpose-built — not a general chatbot.",
    },
    {
      step: "02",
      label: "Deploy in minutes",
      body: "Connect your channels, review the defaults, and go live. No engineering required.",
    },
    {
      step: "03",
      label: "Grow with trust",
      body: "The more it performs, the more autonomy it earns — and the less you have to oversee.",
    },
  ],
  channels: [
    { name: "WhatsApp", icon: "💬" },
    { name: "Telegram", icon: "✈️" },
    { name: "Web widget", icon: "🌐" },
  ],
  trustNote:
    "Every agent starts supervised. It earns autonomy by proving itself — in your context, with your standards.",
  faq: [
    {
      q: "Is this a general chatbot?",
      a: "No — each agent is purpose-built for a specific job. Narrow scope means higher reliability.",
    },
    {
      q: "Do I need technical skills to set it up?",
      a: "No. Setup takes minutes. If you run into anything, we walk you through it personally.",
    },
    {
      q: "What if it makes a mistake?",
      a: "Everything is reviewable. You can correct any action and the agent learns from your feedback.",
    },
    {
      q: "How do I know it's working?",
      a: "You get a full log of every conversation and action. Performance is visible from day one.",
    },
  ],
};
