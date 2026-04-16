import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works — Switchboard",
  description:
    "Find the right agent, connect it to your channels, and let it earn autonomy through real performance.",
};

const ACTS = [
  {
    n: "01",
    title: "Find the right agent for the job",
    subtitle: "Browse",
    copy: "Every agent is built around a specific business outcome — qualifying leads, booking calls, re-engaging cold contacts. Browse by outcome, not by feature list. Each one is designed for a specific job, so you're not buying potential — you're deploying a proven pattern.",
    visual: (
      <div
        className="flex items-center gap-3 rounded-xl p-5"
        style={{ background: "hsl(38 45% 94%)", border: "1px solid hsl(35 18% 88%)" }}
      >
        {[
          { label: "Speed-to-Lead", role: "Qualifies leads", color: "hsl(238 28% 56%)" },
          { label: "Sales Closer", role: "Books calls", color: "hsl(152 28% 40%)" },
        ].map(({ label, role, color }) => (
          <div
            key={label}
            className="flex-1 rounded-lg p-3 text-center"
            style={{ background: "hsl(0 0% 100%)", border: "1px solid hsl(35 12% 90%)" }}
          >
            <div
              className="mx-auto mb-2 h-8 w-8 rounded-full"
              style={{ background: `${color}20`, border: `1.5px solid ${color}40` }}
            />
            <p className="text-xs font-medium" style={{ color: "hsl(30 8% 12%)" }}>
              {label}
            </p>
            <p className="mt-0.5 text-[10px]" style={{ color: "hsl(30 5% 55%)" }}>
              {role}
            </p>
          </div>
        ))}
      </div>
    ),
  },
  {
    n: "02",
    title: "Connect it to your channels in minutes",
    subtitle: "Deploy",
    copy: "No code. Choose a channel, connect it to your account, and the agent is live. We handle the integration — you handle the business. Channels are where your customers already are.",
    visual: (
      <div
        className="rounded-xl p-5"
        style={{ background: "hsl(38 45% 94%)", border: "1px solid hsl(35 18% 88%)" }}
      >
        <div className="flex items-center justify-between">
          {[
            { label: "WhatsApp", color: "hsl(142 50% 42%)" },
            { label: "Telegram", color: "hsl(206 62% 50%)" },
            { label: "Web widget", color: "hsl(30 55% 46%)" },
          ].map(({ label, color }, i) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ background: `${color}15`, border: `1.5px solid ${color}35` }}
              >
                <div className="h-3 w-3 rounded-full" style={{ background: color }} />
              </div>
              <span className="text-[10px] font-medium" style={{ color: "hsl(30 5% 45%)" }}>
                {label}
              </span>
              {i < 2 && (
                <div
                  className="absolute"
                  style={{
                    width: 20,
                    height: 1,
                    background: "hsl(30 15% 80%)",
                  }}
                />
              )}
            </div>
          ))}
          <div className="h-px flex-1 mx-3" style={{ background: "hsl(30 15% 80%)" }} />
          <div
            className="flex h-10 items-center gap-2 rounded-full px-4"
            style={{ background: "hsl(30 55% 46%)", color: "white" }}
          >
            <span className="text-xs font-medium">Go live</span>
          </div>
        </div>
        <p className="mt-4 text-xs text-center" style={{ color: "hsl(30 5% 55%)" }}>
          No code required — connect and launch in minutes
        </p>
      </div>
    ),
  },
  {
    n: "03",
    title: "Earn trust. Earn autonomy.",
    subtitle: "Earn trust",
    copy: "Every agent starts supervised. It proves itself through real tasks — you review and approve its first actions. As its trust score climbs, it earns more operating freedom. You step in only when it flags something important. Governance isn't a constraint — it's what makes the system safe to scale.",
    visual: (
      <div
        className="rounded-xl p-5"
        style={{ background: "hsl(38 45% 94%)", border: "1px solid hsl(35 18% 88%)" }}
      >
        {[
          { label: "Starts supervised", score: "0", active: false },
          { label: "First tasks approved", score: "40", active: false },
          { label: "Earns autonomy", score: "70", active: false },
          { label: "Fully trusted", score: "90+", active: true },
        ].map(({ label, score, active }, i) => (
          <div key={score} className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium"
              style={{
                background: active ? "hsl(30 55% 46%)" : "hsl(30 8% 90%)",
                color: active ? "white" : "hsl(30 5% 50%)",
              }}
            >
              {score}
            </div>
            <div className="flex flex-1 items-center gap-2">
              <p
                className="text-xs font-medium"
                style={{ color: active ? "hsl(30 8% 12%)" : "hsl(30 5% 52%)" }}
              >
                {label}
              </p>
              {active && (
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide"
                  style={{ background: "hsl(30 55% 46% / 0.12)", color: "hsl(30 55% 42%)" }}
                >
                  Goal
                </span>
              )}
            </div>
            {i < 3 && (
              <div
                className="ml-4 mt-1 h-4 w-px self-end"
                style={{ background: "hsl(30 15% 82%)" }}
              />
            )}
          </div>
        ))}
      </div>
    ),
  },
];

export default function HowItWorksPage() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="pb-16 pt-32" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          <p
            className="mb-4 text-xs font-medium uppercase tracking-widest"
            style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
          >
            How it works
          </p>
          <h1
            className="font-display font-light"
            style={{
              fontSize: "clamp(2.8rem, 5.5vw, 5rem)",
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              color: "hsl(30 8% 10%)",
              maxWidth: "18ch",
            }}
          >
            From discovery to trusted automation.
          </h1>
          <p
            className="mt-6 text-lg leading-relaxed"
            style={{ color: "hsl(30 6% 42%)", maxWidth: "52ch" }}
          >
            Find the right agent, connect it to your channels, and let it earn autonomy through real
            performance.
          </p>
        </div>
      </section>

      {/* ── 3 Acts ── */}
      <section className="py-8" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width space-y-24">
          {ACTS.map(({ n, title, subtitle, copy, visual }, i) => (
            <div
              key={n}
              className={`grid grid-cols-1 items-center gap-12 lg:grid-cols-2 ${i % 2 === 1 ? "lg:[&>div:first-child]:order-2" : ""}`}
            >
              {/* Text */}
              <div>
                <div className="mb-6 flex items-baseline gap-4">
                  <span
                    className="font-display"
                    style={{
                      fontSize: "5.5rem",
                      fontWeight: 200,
                      lineHeight: 1,
                      color: "hsl(30 20% 88%)",
                      letterSpacing: "-0.04em",
                      userSelect: "none",
                    }}
                  >
                    {n}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider"
                    style={{
                      background: "hsl(30 55% 46% / 0.1)",
                      color: "hsl(30 50% 42%)",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {subtitle}
                  </span>
                </div>
                <h2
                  className="mb-5 font-display font-light"
                  style={{
                    fontSize: "clamp(1.6rem, 2.5vw, 2.2rem)",
                    letterSpacing: "-0.015em",
                    color: "hsl(30 8% 10%)",
                  }}
                >
                  {title}
                </h2>
                <p className="text-base leading-relaxed" style={{ color: "hsl(30 5% 44%)" }}>
                  {copy}
                </p>
              </div>

              {/* Visual */}
              <div>{visual}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Governance strip ── */}
      <section
        className="py-16"
        style={{ background: "hsl(40 20% 96%)", borderTop: "1px solid hsl(35 15% 90%)" }}
      >
        <div className="page-width text-center">
          <p
            className="mx-auto max-w-2xl text-sm leading-relaxed"
            style={{ color: "hsl(30 5% 48%)" }}
          >
            Switchboard&rsquo;s governance layer audits every action, tracks trust in real time, and
            puts humans back in control when it matters.{" "}
            <span style={{ color: "hsl(30 8% 28%)" }}>
              That&rsquo;s not compliance theater — it&rsquo;s what makes the system safe to scale.
            </span>
          </p>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className="py-24" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-center sm:gap-6">
          <Link
            href="/agents"
            className="rounded-full px-8 py-4 text-sm font-medium"
            style={{ background: "hsl(30 55% 46%)", color: "white" }}
          >
            Browse agents
          </Link>
          <Link
            href="/get-started"
            className="rounded-full border px-8 py-4 text-sm font-medium transition-colors"
            style={{
              borderColor: "hsl(35 15% 85%)",
              color: "hsl(30 6% 38%)",
              background: "transparent",
            }}
          >
            Join waitlist
          </Link>
        </div>
      </section>
    </>
  );
}
