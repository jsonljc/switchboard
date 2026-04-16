import type { Metadata } from "next";
import Link from "next/link";
import { getListedAgents, getDemoTaskStats } from "@/lib/demo-data";
import { HomepageHero } from "@/components/landing/homepage-hero";
import { AgentMarketplaceCard } from "@/components/landing/agent-marketplace-card";
import type { RoleFocus } from "@/components/character/operator-character";

export const metadata: Metadata = {
  title: "Switchboard — Your AI sales team, ready in minutes",
  description:
    "Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website. They qualify leads, book calls, and earn your trust over time.",
};

const ROLE_MAP: Record<string, RoleFocus> = {
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

const PREVIEW_SLUGS = ["speed-to-lead", "sales-closer", "nurture-specialist"];

const PROBLEMS = [
  {
    problem: "Missed leads",
    solution: "Speed-to-Lead",
    description: "Qualifies inbound leads within minutes — before they go cold.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M11 3v2M11 17v2M3 11h2M17 11h2M5.64 5.64l1.42 1.42M14.95 14.95l1.41 1.41M5.64 16.36l1.42-1.42M14.95 7.05l1.41-1.41"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="11" cy="11" r="4" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    problem: "Slow follow-up",
    solution: "Sales Closer",
    description: "Books calls and closes deals while your team is focused elsewhere.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M4 7h14M4 11h10M4 15h7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    problem: "No sales team",
    solution: "Nurture Specialist",
    description: "Re-engages cold contacts and keeps relationships warm automatically.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path
          d="M11 4C7.13 4 4 7.13 4 11c0 1.74.63 3.33 1.67 4.56L4 19l3.44-1.67A6.93 6.93 0 0011 18c3.87 0 7-3.13 7-7s-3.13-7-7-7z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const STEPS = [
  {
    n: "01",
    title: "Browse",
    desc: "Find an agent built for your outcome, not a feature list.",
  },
  {
    n: "02",
    title: "Deploy",
    desc: "Connect to WhatsApp, Telegram, or your website. No code.",
  },
  {
    n: "03",
    title: "Earn trust",
    desc: "It starts supervised and earns autonomy through real performance.",
  },
];

const TRUST_STEPS = [
  { score: "0", label: "Starts free", color: "hsl(30 5% 72%)" },
  { score: "40+", label: "Basic autonomy", color: "hsl(38 45% 58%)" },
  { score: "70+", label: "Semi-autonomous", color: "hsl(30 50% 50%)" },
  { score: "90+", label: "Fully trusted", color: "hsl(30 55% 42%)" },
];

export default async function HomePage() {
  const agents = await getListedAgents();
  const previewAgents = PREVIEW_SLUGS.map((slug) => agents.find((a) => a.slug === slug)).filter(
    Boolean,
  );

  const previewWithStats = await Promise.all(
    previewAgents.map(async (agent) => ({
      agent: agent!,
      stats: await getDemoTaskStats(agent!.id),
    })),
  );

  return (
    <>
      {/* ── Hero ── */}
      <HomepageHero />

      {/* ── Problem → Solution strip ── */}
      <section className="py-20" style={{ background: "hsl(40 20% 96%)" }}>
        <div className="page-width">
          <p
            className="mb-10 text-center text-xs font-medium uppercase tracking-widest"
            style={{ color: "hsl(30 6% 52%)", letterSpacing: "0.14em" }}
          >
            Built for real business problems
          </p>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {PROBLEMS.map(({ problem, solution, description, icon }) => (
              <div
                key={problem}
                className="rounded-2xl p-8"
                style={{
                  background: "hsl(0 0% 100%)",
                  border: "1px solid hsl(35 15% 90%)",
                }}
              >
                <div
                  className="mb-5 inline-flex rounded-xl p-3"
                  style={{
                    background: "hsl(30 55% 46% / 0.08)",
                    color: "hsl(30 55% 46%)",
                  }}
                >
                  {icon}
                </div>
                <p className="mb-1 text-xs font-medium" style={{ color: "hsl(30 5% 60%)" }}>
                  Problem: {problem}
                </p>
                <h3
                  className="mb-2 font-display text-2xl font-light"
                  style={{ color: "hsl(30 8% 10%)", letterSpacing: "-0.01em" }}
                >
                  {solution}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "hsl(30 5% 42%)" }}>
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works preview ── */}
      <section className="py-24" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          <div className="mb-16 text-center">
            <p
              className="mb-3 text-xs font-medium uppercase tracking-widest"
              style={{ color: "hsl(30 6% 52%)", letterSpacing: "0.14em" }}
            >
              How it works
            </p>
            <h2
              className="font-display font-light"
              style={{
                fontSize: "clamp(2rem, 3.5vw, 3rem)",
                letterSpacing: "-0.02em",
                color: "hsl(30 8% 10%)",
              }}
            >
              From discovery to trusted automation.
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
            {STEPS.map(({ n, title, desc }) => (
              <div key={n} className="relative">
                <p
                  className="mb-4 font-display"
                  style={{
                    fontSize: "5rem",
                    fontWeight: 200,
                    lineHeight: 1,
                    color: "hsl(30 20% 88%)",
                    letterSpacing: "-0.04em",
                    userSelect: "none",
                  }}
                >
                  {n}
                </p>
                <h3
                  className="mb-2 font-display text-2xl font-light"
                  style={{ color: "hsl(30 8% 10%)", letterSpacing: "-0.01em" }}
                >
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "hsl(30 5% 45%)" }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              href="/how-it-works"
              className="text-sm font-medium transition-colors"
              style={{ color: "hsl(30 45% 45%)" }}
            >
              See the full breakdown →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Agent preview cards ── */}
      {previewWithStats.length > 0 && (
        <section className="py-24" style={{ background: "hsl(40 20% 96%)" }}>
          <div className="page-width">
            <div className="mb-14 flex items-end justify-between">
              <h2
                className="font-display font-light"
                style={{
                  fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
                  letterSpacing: "-0.02em",
                  color: "hsl(30 8% 10%)",
                }}
              >
                Meet the team.
              </h2>
              <Link
                href="/agents"
                className="hidden text-sm font-medium transition-colors sm:block"
                style={{ color: "hsl(30 45% 45%)" }}
              >
                See all agents →
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {previewWithStats.map(({ agent, stats }, i) => {
                const meta = agent.metadata as Record<string, unknown> | null;
                return (
                  <AgentMarketplaceCard
                    key={agent.id}
                    name={agent.name}
                    slug={agent.slug}
                    description={agent.description}
                    trustScore={agent.trustScore}
                    autonomyLevel={agent.autonomyLevel}
                    roleFocus={ROLE_MAP[agent.slug] ?? "default"}
                    bundleSlug={(meta?.bundleSlug as string) ?? "sales-pipeline-bundle"}
                    stats={{
                      totalTasks: stats.totalTasks,
                      approvalRate: stats.approvalRate,
                      lastActiveAt: stats.lastActiveAt?.toISOString() ?? null,
                    }}
                    animationDelay={i * 120}
                  />
                );
              })}
            </div>

            <div className="mt-8 text-center sm:hidden">
              <Link
                href="/agents"
                className="text-sm font-medium"
                style={{ color: "hsl(30 45% 45%)" }}
              >
                See all agents →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Trust explainer ── */}
      <section className="py-24" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          <div className="mx-auto max-w-2xl text-center">
            <h2
              className="mb-4 font-display font-light"
              style={{
                fontSize: "clamp(1.8rem, 3vw, 2.6rem)",
                letterSpacing: "-0.02em",
                color: "hsl(30 8% 10%)",
              }}
            >
              Pricing that earns its way up.
            </h2>
            <p className="text-base leading-relaxed" style={{ color: "hsl(30 6% 42%)" }}>
              Agents start free. As they prove themselves through real performance, they unlock more
              autonomy. You only pay for what&rsquo;s working.
            </p>
          </div>

          {/* Trust progression arc */}
          <div className="mx-auto mt-16 max-w-3xl">
            <div className="relative flex items-end justify-between gap-2">
              {/* Connecting line */}
              <div
                className="absolute inset-x-0"
                style={{
                  bottom: 36,
                  height: 1,
                  background:
                    "linear-gradient(to right, hsl(30 5% 80%), hsl(30 50% 50%), hsl(30 55% 42%))",
                  marginLeft: "calc(12.5% - 1px)",
                  marginRight: "calc(12.5% - 1px)",
                }}
              />
              {TRUST_STEPS.map(({ score, label, color }, i) => (
                <div key={score} className="relative flex flex-1 flex-col items-center gap-3">
                  <p className="text-xs font-medium" style={{ color: "hsl(30 5% 55%)" }}>
                    {label}
                  </p>
                  {/* Node */}
                  <div
                    className="relative z-10 flex h-[72px] w-[72px] flex-col items-center justify-center rounded-full"
                    style={{
                      background: `${color}18`,
                      border: `1.5px solid ${color}40`,
                    }}
                  >
                    <span
                      className="font-display"
                      style={{
                        fontSize: "1.1rem",
                        fontWeight: 300,
                        color,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {score}
                    </span>
                    <span
                      className="text-[9px] font-medium uppercase tracking-wider"
                      style={{ color }}
                    >
                      trust
                    </span>
                  </div>
                  {/* Index dot */}
                  <div
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: i === 3 ? color : "hsl(30 8% 78%)" }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14 text-center">
            <Link
              href="/pricing"
              className="mr-5 text-sm font-medium transition-colors"
              style={{ color: "hsl(30 45% 45%)" }}
            >
              See full pricing →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section
        className="py-24"
        style={{
          background: "linear-gradient(to bottom, hsl(38 55% 94%), hsl(45 25% 98%))",
        }}
      >
        <div className="page-width text-center">
          <h2
            className="mb-4 font-display font-light"
            style={{
              fontSize: "clamp(2rem, 4vw, 3.5rem)",
              letterSpacing: "-0.025em",
              color: "hsl(30 8% 10%)",
            }}
          >
            Ready to meet your team?
          </h2>
          <p className="mb-10 text-base" style={{ color: "hsl(30 6% 45%)" }}>
            Join 200+ businesses on the early access list.
          </p>
          <Link
            href="/get-started"
            className="inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-medium tracking-wide"
            style={{ background: "hsl(30 55% 46%)", color: "white" }}
          >
            Get early access
          </Link>
        </div>
      </section>
    </>
  );
}
