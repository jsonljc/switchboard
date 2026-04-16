import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Pricing — Switchboard",
  description:
    "Agents start free. As they prove themselves, they unlock more autonomy — and you only pay for what's working.",
};

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    threshold: "Start here",
    thresholdScore: null,
    autonomy: "Supervised",
    autonomyDesc: "Every action reviewed by you",
    capabilities: [
      "Up to 50 tasks/month",
      "All channels (WhatsApp, Telegram, web)",
      "Full audit trail",
      "Manual approval required",
    ],
    cta: "Get started free",
    ctaHref: "/get-started",
    highlight: false,
    bg: "hsl(0 0% 100%)",
    border: "hsl(35 12% 88%)",
    scoreColor: "hsl(30 5% 65%)",
  },
  {
    name: "Basic",
    price: "$49", // [TBD — placeholder]
    period: "per month",
    threshold: "Unlocks at 40+ trust",
    thresholdScore: 40,
    autonomy: "Semi-supervised",
    autonomyDesc: "Routine tasks run independently",
    capabilities: [
      "Unlimited tasks",
      "Routine actions auto-approved",
      "Exception-only review",
      "Performance analytics",
    ],
    cta: "Join waitlist",
    ctaHref: "/get-started",
    highlight: false,
    bg: "hsl(38 30% 97%)",
    border: "hsl(35 18% 86%)",
    scoreColor: "hsl(38 45% 52%)",
  },
  {
    name: "Pro",
    price: "$149", // [TBD — placeholder]
    period: "per month",
    threshold: "Unlocks at 70+ trust",
    thresholdScore: 70,
    autonomy: "Autonomous",
    autonomyDesc: "Operates independently within scope",
    capabilities: [
      "Everything in Basic",
      "Multi-agent coordination",
      "Custom guardrails",
      "Priority support",
    ],
    cta: "Join waitlist",
    ctaHref: "/get-started",
    highlight: true,
    bg: "hsl(30 40% 96%)",
    border: "hsl(30 35% 80%)",
    scoreColor: "hsl(30 50% 46%)",
  },
  {
    name: "Elite",
    price: "$349", // [TBD — placeholder]
    period: "per month",
    threshold: "Unlocks at 90+ trust",
    thresholdScore: 90,
    autonomy: "Fully trusted",
    autonomyDesc: "Humans step in only on exception",
    capabilities: [
      "Everything in Pro",
      "Dedicated account support",
      "Custom agent configuration",
      "SLA guarantees",
    ],
    cta: "Join waitlist",
    ctaHref: "/get-started",
    highlight: false,
    bg: "hsl(30 8% 10%)",
    border: "hsl(30 8% 20%)",
    scoreColor: "hsl(30 55% 55%)",
  },
];

const FAQ = [
  {
    q: "Can I downgrade an agent?",
    a: "Yes. You can manually cap any agent at a lower tier regardless of its trust score. You stay in control at all times.",
  },
  {
    q: "How does an agent earn trust?",
    a: "Trust is calculated from its track record: tasks completed correctly, approvals received, exceptions flagged, and consistency over time. The more reliably it performs, the higher its score.",
  },
  {
    q: "Do I need a credit card to start?",
    a: "No. Every agent starts on Free with no payment required. You only upgrade when the agent has earned it.",
  },
  {
    q: "What happens if an agent loses trust score?",
    a: "If performance drops below a tier's threshold, the agent reverts to the previous tier automatically. You'll be notified, and it will require more supervision until it earns the score back.",
  },
];

export default function PricingPage() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="pb-16 pt-32" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width text-center">
          <p
            className="mb-4 text-xs font-medium uppercase tracking-widest"
            style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
          >
            Pricing
          </p>
          <h1
            className="mx-auto font-display font-light"
            style={{
              fontSize: "clamp(2.5rem, 5vw, 4.5rem)",
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              color: "hsl(30 8% 10%)",
              maxWidth: "14ch",
            }}
          >
            Pricing that grows with trust.
          </h1>
          <p
            className="mx-auto mt-5 text-base leading-relaxed"
            style={{ color: "hsl(30 6% 44%)", maxWidth: "48ch" }}
          >
            Agents start free. As they prove themselves, they unlock more autonomy — and you only
            pay for what&rsquo;s working.
          </p>

          {/* Bridge */}
          <p className="mx-auto mt-6 text-sm" style={{ color: "hsl(30 5% 52%)", maxWidth: "52ch" }}>
            Every agent starts on Free. As it proves reliability, safety, and performance, it
            unlocks higher tiers with more autonomy.
          </p>
        </div>
      </section>

      {/* ── Tier progression cards ── */}
      <section className="pb-24 pt-8" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          {/* Connecting arrow */}
          <div className="mb-8 hidden items-center gap-2 md:flex">
            <div className="h-px flex-1" style={{ background: "hsl(35 15% 86%)" }} />
            <span className="text-xs" style={{ color: "hsl(30 5% 62%)" }}>
              performance unlocks each stage →
            </span>
            <div className="h-px flex-1" style={{ background: "hsl(35 15% 86%)" }} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {TIERS.map(
              ({
                name,
                price,
                period,
                threshold,
                thresholdScore,
                autonomy,
                autonomyDesc,
                capabilities,
                cta,
                ctaHref,
                highlight,
                bg,
                border,
                scoreColor,
              }) => {
                const isDark = name === "Elite";
                const textColor = isDark ? "hsl(40 15% 88%)" : "hsl(30 8% 10%)";
                const mutedColor = isDark ? "hsl(30 5% 52%)" : "hsl(30 5% 50%)";

                return (
                  <div
                    key={name}
                    className="relative flex flex-col rounded-2xl p-6"
                    style={{
                      background: bg,
                      border: `1.5px solid ${highlight ? "hsl(30 40% 72%)" : border}`,
                      boxShadow: highlight
                        ? "0 4px 24px hsl(30 40% 50% / 0.12)"
                        : "0 1px 4px hsl(30 8% 10% / 0.04)",
                    }}
                  >
                    {highlight && (
                      <div
                        className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wider"
                        style={{ background: "hsl(30 55% 46%)", color: "white" }}
                      >
                        Most popular
                      </div>
                    )}

                    {/* Trust threshold — most prominent */}
                    <div className="mb-4">
                      {thresholdScore !== null ? (
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-light"
                            style={{
                              background: `${scoreColor}18`,
                              border: `1.5px solid ${scoreColor}35`,
                              color: scoreColor,
                            }}
                          >
                            {thresholdScore}
                          </div>
                          <span className="text-xs font-medium" style={{ color: scoreColor }}>
                            {threshold}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-8 w-8 items-center justify-center rounded-full"
                            style={{
                              background: `${scoreColor}18`,
                              border: `1.5px solid ${scoreColor}35`,
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path
                                d="M2 6l3 3 5-5"
                                stroke={scoreColor}
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                          <span className="text-xs font-medium" style={{ color: scoreColor }}>
                            {threshold}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Tier name & price */}
                    <h3
                      className="mb-1 font-display text-2xl font-light"
                      style={{ color: textColor, letterSpacing: "-0.01em" }}
                    >
                      {name}
                    </h3>
                    <div className="mb-3 flex items-baseline gap-1.5">
                      <span
                        className="font-display text-3xl font-light"
                        style={{ color: textColor, letterSpacing: "-0.02em" }}
                      >
                        {price}
                      </span>
                      <span className="text-xs" style={{ color: mutedColor }}>
                        {period}
                      </span>
                    </div>

                    {/* Autonomy level */}
                    <div
                      className="mb-5 rounded-lg p-3"
                      style={{
                        background: isDark ? "hsl(30 8% 15%)" : "hsl(30 8% 10% / 0.04)",
                      }}
                    >
                      <p
                        className="text-xs font-medium uppercase tracking-wide"
                        style={{ color: scoreColor, letterSpacing: "0.08em" }}
                      >
                        {autonomy}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: mutedColor }}>
                        {autonomyDesc}
                      </p>
                    </div>

                    {/* Capabilities */}
                    <ul className="mb-6 flex-1 space-y-2.5">
                      {capabilities.map((c) => (
                        <li
                          key={c}
                          className="flex items-start gap-2 text-xs"
                          style={{ color: mutedColor }}
                        >
                          <svg
                            className="mt-0.5 flex-shrink-0"
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            fill="none"
                          >
                            <path
                              d="M2 5l2 2 4-4"
                              stroke={scoreColor}
                              strokeWidth="1.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          {c}
                        </li>
                      ))}
                    </ul>

                    {/* CTA */}
                    <Link
                      href={ctaHref}
                      className="block rounded-full py-3 text-center text-sm font-medium transition-all"
                      style={
                        highlight
                          ? { background: "hsl(30 55% 46%)", color: "white" }
                          : isDark
                            ? {
                                background: "hsl(30 55% 46%)",
                                color: "white",
                              }
                            : {
                                background: "transparent",
                                border: `1px solid ${border}`,
                                color: "hsl(30 6% 38%)",
                              }
                      }
                    >
                      {cta}
                    </Link>
                  </div>
                );
              },
            )}
          </div>

          {/* Placeholder notice */}
          <p className="mt-4 text-center text-xs" style={{ color: "hsl(30 5% 62%)" }}>
            * Prices are illustrative — final pricing set at launch.
          </p>
        </div>
      </section>

      {/* ── Differentiator strip ── */}
      <section
        className="py-14"
        style={{ background: "hsl(40 20% 96%)", borderTop: "1px solid hsl(35 15% 90%)" }}
      >
        <div className="page-width">
          <div
            className="mx-auto max-w-2xl rounded-2xl p-8 text-center"
            style={{ background: "hsl(38 45% 93%)", border: "1px solid hsl(35 25% 84%)" }}
          >
            <p
              className="font-display text-xl font-light"
              style={{ color: "hsl(30 8% 12%)", letterSpacing: "-0.01em", lineHeight: 1.5 }}
            >
              &ldquo;Unlike per-seat or per-call pricing, you pay more when your agent earns it.
              Agents that underperform stay on free.&rdquo;
            </p>
          </div>
          <p
            className="mx-auto mt-6 max-w-lg text-center text-sm"
            style={{ color: "hsl(30 5% 52%)" }}
          >
            You can start free, monitor performance, and upgrade only when the agent has
            demonstrated it can handle more on its own.
          </p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-24" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          <h2
            className="mb-12 text-center font-display font-light"
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              letterSpacing: "-0.02em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Common questions.
          </h2>
          <div className="mx-auto max-w-2xl space-y-8">
            {FAQ.map(({ q, a }) => (
              <div key={q} className="border-b pb-8" style={{ borderColor: "hsl(35 12% 90%)" }}>
                <h3
                  className="mb-3 font-display text-lg font-light"
                  style={{ color: "hsl(30 8% 12%)", letterSpacing: "-0.01em" }}
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
          <Link
            href="/get-started"
            className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-medium"
            style={{ background: "hsl(30 55% 46%)", color: "white" }}
          >
            Start with a free agent →
          </Link>
        </div>
      </section>
    </>
  );
}
