import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getListingBySlug } from "@/lib/demo-data";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";

const ROLE_MAP: Record<string, RoleFocus> = {
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

// ── Static marketing content per agent ──

interface AgentContent {
  tagline: string;
  capabilities: string[];
  howItWorks: { step: string; label: string; body: string }[];
  channels: { name: string; icon: string }[];
  trustNote: string;
  faq: { q: string; a: string }[];
}

const AGENT_CONTENT: Record<string, AgentContent> = {
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

const FALLBACK_CONTENT: AgentContent = {
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

// ── Trust tier lookup ──

function trustTierLabel(priceTier: string): { name: string; desc: string; score: string } {
  switch (priceTier) {
    case "basic":
      return { name: "Basic", desc: "Routine tasks run independently", score: "40+" };
    case "pro":
      return { name: "Pro", desc: "Operates independently within scope", score: "70+" };
    case "elite":
      return { name: "Elite", desc: "Humans step in only on exception", score: "90+" };
    default:
      return { name: "Free", desc: "Every action reviewed by you", score: "—" };
  }
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(slug).catch(() => null);
  if (!listing) return { title: "Agent Not Found — Switchboard" };
  return {
    title: `${listing.name} — Switchboard`,
    description: listing.description,
  };
}

export default async function AgentProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug).catch(() => null);
  if (!listing) notFound();

  const content = AGENT_CONTENT[slug] ?? FALLBACK_CONTENT;
  const roleFocus = ROLE_MAP[slug] ?? ("default" as RoleFocus);
  const tier = trustTierLabel(listing.priceTier);

  return (
    <div style={{ background: "hsl(45 25% 98%)" }}>
      {/* ── Header ── */}
      <section
        className="pt-28 pb-16"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 60% 0%, hsl(38 70% 91%) 0%, transparent 65%)",
        }}
      >
        <div className="page-width max-w-4xl mx-auto">
          <Link
            href="/agents"
            className="mb-10 inline-flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: "hsl(30 6% 50%)" }}
          >
            ← All agents
          </Link>

          <div className="flex flex-col items-start gap-8 md:flex-row md:items-center">
            <div className="flex-shrink-0">
              <OperatorCharacter roleFocus={roleFocus} className="w-36 h-36" />
            </div>

            <div className="flex-1">
              {/* Category chip */}
              <span
                className="mb-3 inline-block rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider"
                style={{ background: "hsl(30 55% 46% / 0.1)", color: "hsl(30 50% 42%)" }}
              >
                {listing.taskCategories[0] ?? "Sales"}
              </span>

              <h1
                className="font-display font-light"
                style={{
                  fontSize: "clamp(2.2rem, 4vw, 3.6rem)",
                  lineHeight: 1.05,
                  letterSpacing: "-0.02em",
                  color: "hsl(30 8% 10%)",
                }}
              >
                {listing.name}
              </h1>

              <p
                className="mt-3 text-base leading-relaxed"
                style={{ color: "hsl(30 6% 40%)", maxWidth: "52ch" }}
              >
                {content.tagline}
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Link
                  href="/get-started"
                  className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-medium"
                  style={{ background: "hsl(30 55% 46%)", color: "white" }}
                >
                  Get early access
                </Link>

                {/* Trust score badge */}
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full font-display text-xs font-light"
                    style={{
                      background: "hsl(30 55% 46% / 0.1)",
                      border: "1.5px solid hsl(30 55% 46% / 0.3)",
                      color: "hsl(30 50% 42%)",
                    }}
                  >
                    {listing.trustScore}
                  </div>
                  <span className="text-xs" style={{ color: "hsl(30 5% 52%)" }}>
                    trust score
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section
        className="py-16"
        style={{ background: "hsl(40 20% 96%)", borderTop: "1px solid hsl(35 12% 90%)" }}
      >
        <div className="page-width max-w-4xl mx-auto">
          <p
            className="mb-2 text-xs font-medium uppercase tracking-widest"
            style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
          >
            What it does
          </p>
          <h2
            className="mb-10 font-display font-light"
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
              letterSpacing: "-0.02em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Built for one job.
            <br />
            <em style={{ fontStyle: "italic", color: "hsl(30 48% 40%)" }}>Done well.</em>
          </h2>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {content.capabilities.map((cap) => (
              <li
                key={cap}
                className="flex items-start gap-3 rounded-2xl p-5"
                style={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(35 12% 88%)" }}
              >
                <span
                  className="mt-0.5 flex-shrink-0 flex h-5 w-5 items-center justify-center rounded-full"
                  style={{ background: "hsl(30 55% 46% / 0.1)" }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M2 5l2 2 4-4"
                      stroke="hsl(30 55% 46%)"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-sm leading-relaxed" style={{ color: "hsl(30 5% 35%)" }}>
                  {cap}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="py-20" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width max-w-4xl mx-auto">
          <p
            className="mb-2 text-xs font-medium uppercase tracking-widest"
            style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
          >
            How it works
          </p>
          <h2
            className="mb-14 font-display font-light"
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
              letterSpacing: "-0.02em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Simple from day one.
          </h2>

          <div className="space-y-12">
            {content.howItWorks.map(({ step, label, body }) => (
              <div key={step} className="flex gap-6 md:gap-10">
                <span
                  className="font-display flex-shrink-0"
                  style={{
                    fontSize: "3.5rem",
                    fontWeight: 200,
                    lineHeight: 1,
                    color: "hsl(30 20% 88%)",
                    letterSpacing: "-0.02em",
                    width: "3rem",
                  }}
                >
                  {step}
                </span>
                <div className="pt-1">
                  <h3
                    className="mb-2 font-display font-light"
                    style={{
                      fontSize: "1.4rem",
                      letterSpacing: "-0.01em",
                      color: "hsl(30 8% 12%)",
                    }}
                  >
                    {label}
                  </h3>
                  <p
                    className="text-sm leading-relaxed"
                    style={{ color: "hsl(30 5% 45%)", maxWidth: "52ch" }}
                  >
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust & Pricing ── */}
      <section
        className="py-16"
        style={{
          background: "hsl(38 35% 95%)",
          borderTop: "1px solid hsl(35 15% 88%)",
          borderBottom: "1px solid hsl(35 15% 88%)",
        }}
      >
        <div className="page-width max-w-4xl mx-auto">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-16">
            <div className="flex-1">
              <p
                className="mb-2 text-xs font-medium uppercase tracking-widest"
                style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
              >
                Trust & pricing
              </p>
              <h2
                className="mb-4 font-display font-light"
                style={{
                  fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
                  letterSpacing: "-0.02em",
                  color: "hsl(30 8% 10%)",
                }}
              >
                Starts free.
                <br />
                Earns its way up.
              </h2>
              <p
                className="mb-6 text-sm leading-relaxed"
                style={{ color: "hsl(30 5% 45%)", maxWidth: "44ch" }}
              >
                {content.trustNote}
              </p>
              <Link
                href="/pricing"
                className="text-sm font-medium transition-colors"
                style={{ color: "hsl(30 48% 42%)" }}
              >
                See full pricing →
              </Link>
            </div>

            {/* Current tier card */}
            <div
              className="rounded-2xl p-6 md:w-64"
              style={{
                background: "hsl(0 0% 100%)",
                border: "1.5px solid hsl(35 18% 86%)",
              }}
            >
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-light"
                  style={{
                    background: "hsl(30 55% 46% / 0.1)",
                    border: "1.5px solid hsl(30 55% 46% / 0.3)",
                    color: "hsl(30 50% 42%)",
                  }}
                >
                  {tier.score}
                </div>
                <span className="text-xs font-medium" style={{ color: "hsl(30 50% 42%)" }}>
                  Current tier
                </span>
              </div>
              <p
                className="font-display text-2xl font-light"
                style={{ color: "hsl(30 8% 10%)", letterSpacing: "-0.01em" }}
              >
                {tier.name}
              </p>
              <p className="mt-1 text-xs" style={{ color: "hsl(30 5% 50%)" }}>
                {tier.desc}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Channels ── */}
      <section className="py-16" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width max-w-4xl mx-auto">
          <p
            className="mb-2 text-xs font-medium uppercase tracking-widest"
            style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
          >
            Channels
          </p>
          <h2
            className="mb-8 font-display font-light"
            style={{
              fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
              letterSpacing: "-0.02em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Works where your customers are.
          </h2>

          <div className="flex flex-wrap gap-4">
            {content.channels.map(({ name, icon }) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-full px-5 py-3"
                style={{
                  background: "hsl(40 20% 96%)",
                  border: "1px solid hsl(35 12% 88%)",
                }}
              >
                <span className="text-lg">{icon}</span>
                <span className="text-sm font-medium" style={{ color: "hsl(30 8% 22%)" }}>
                  {name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        className="py-20"
        style={{ background: "hsl(40 20% 96%)", borderTop: "1px solid hsl(35 12% 90%)" }}
      >
        <div className="page-width max-w-3xl mx-auto">
          <h2
            className="mb-12 font-display font-light"
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
              letterSpacing: "-0.02em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Common questions.
          </h2>

          <div className="space-y-8">
            {content.faq.map(({ q, a }) => (
              <div key={q} className="border-b pb-8" style={{ borderColor: "hsl(35 12% 87%)" }}>
                <h3
                  className="mb-3 font-display font-light"
                  style={{ fontSize: "1.2rem", letterSpacing: "-0.01em", color: "hsl(30 8% 12%)" }}
                >
                  {q}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "hsl(30 5% 45%)" }}>
                  {a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section
        className="py-20"
        style={{ background: "linear-gradient(to bottom, hsl(38 50% 94%), hsl(45 25% 98%))" }}
      >
        <div className="page-width text-center">
          <p
            className="mb-6 font-display font-light"
            style={{
              fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
              letterSpacing: "-0.02em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Ready to put {listing.name} to work?
          </p>
          <Link
            href="/get-started"
            className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-medium"
            style={{ background: "hsl(30 55% 46%)", color: "white" }}
          >
            Get early access →
          </Link>
        </div>
      </section>
    </div>
  );
}
