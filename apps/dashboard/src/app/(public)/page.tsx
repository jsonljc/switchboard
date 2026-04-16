import type { Metadata } from "next";
import Link from "next/link";
import { getListedAgents, getDemoTaskStats } from "@/lib/demo-data";
import { HomepageHero } from "@/components/landing/homepage-hero";
import { AgentMarketplaceCard } from "@/components/landing/agent-marketplace-card";

export const metadata: Metadata = {
  title: "Switchboard — Your AI sales team, ready in minutes",
  description:
    "Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website. They qualify leads, book calls, and earn your trust over time.",
};

const PREVIEW_SLUGS = ["speed-to-lead", "sales-closer", "nurture-specialist"];

const PROBLEMS = [
  {
    problem: "Missed leads",
    solution: "Speed-to-Lead",
    description: "Qualifies inbound leads within minutes — before they go cold.",
  },
  {
    problem: "Slow follow-up",
    solution: "Sales Closer",
    description: "Books calls and closes deals while your team is focused elsewhere.",
  },
  {
    problem: "No sales team",
    solution: "Nurture Specialist",
    description: "Re-engages cold contacts and keeps relationships warm automatically.",
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
  { score: "0", label: "Starts free", accent: "#C8C3BC" },
  { score: "40+", label: "Basic autonomy", accent: "#B89870" },
  { score: "70+", label: "Semi-autonomous", accent: "#A07850" },
  { score: "90+", label: "Fully trusted", accent: "#8B6540" },
];

export default async function HomePage() {
  const agents = await getListedAgents().catch(() => []);
  const previewAgents = PREVIEW_SLUGS.map((slug) => agents.find((a) => a.slug === slug)).filter(
    Boolean,
  );

  const previewWithStats = await Promise.all(
    previewAgents.map(async (agent) => ({
      agent: agent!,
      stats: await getDemoTaskStats(agent!.id).catch(() => ({
        totalTasks: 0,
        approvedCount: 0,
        approvalRate: 0,
        lastActiveAt: null,
      })),
    })),
  );

  const alexAgent = agents.find((a) => a.slug === "speed-to-lead") ?? null;

  return (
    <>
      {/* ── Hero ── */}
      <HomepageHero
        previewAgent={
          alexAgent
            ? {
                name: alexAgent.name,
                description: alexAgent.description,
                trustScore: alexAgent.trustScore,
                slug: alexAgent.slug,
              }
            : null
        }
      />

      {/* ── Problem → Solution strip ── */}
      <section style={{ background: "#EDEAE5", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width">
          <p
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#9C958F",
            }}
          >
            Built for real business problems
          </p>
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "3rem",
            }}
          >
            The work that slips through.
            <br />
            Handled.
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {PROBLEMS.map(({ problem, solution, description }) => (
              <div
                key={problem}
                style={{
                  background: "#F9F8F6",
                  border: "1px solid #DDD9D3",
                  borderRadius: "1rem",
                  padding: "1.75rem",
                }}
              >
                <p
                  style={{
                    fontSize: "0.6875rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "#9C958F",
                    marginBottom: "0.5rem",
                  }}
                >
                  {problem}
                </p>
                <h3
                  style={{
                    fontWeight: 700,
                    fontSize: "1.25rem",
                    letterSpacing: "-0.015em",
                    color: "#1A1714",
                    marginBottom: "0.625rem",
                  }}
                >
                  {solution}
                </h3>
                <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#6B6560" }}>
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works preview ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width">
          <p
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#9C958F",
            }}
          >
            How it works
          </p>
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "3rem",
            }}
          >
            From discovery to trusted automation.
          </h2>

          <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
            {STEPS.map(({ n, title, desc }) => (
              <div key={n}>
                <p
                  style={{
                    fontSize: "4rem",
                    fontWeight: 700,
                    lineHeight: 1,
                    letterSpacing: "-0.04em",
                    color: "#DDD9D3",
                    marginBottom: "1rem",
                    userSelect: "none",
                  }}
                >
                  {n}
                </p>
                <h3
                  style={{
                    fontWeight: 700,
                    fontSize: "1.125rem",
                    letterSpacing: "-0.015em",
                    color: "#1A1714",
                    marginBottom: "0.5rem",
                  }}
                >
                  {title}
                </h3>
                <p style={{ fontSize: "0.875rem", lineHeight: 1.55, color: "#6B6560" }}>{desc}</p>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "2.5rem" }}>
            <Link
              href="/how-it-works"
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "#A07850",
                textDecoration: "none",
              }}
            >
              See the full breakdown →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Agent preview cards ── */}
      {previewWithStats.length > 0 && (
        <section style={{ background: "#EDEAE5", paddingTop: "5rem", paddingBottom: "5rem" }}>
          <div className="page-width">
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                marginBottom: "2.5rem",
              }}
            >
              <h2
                style={{
                  fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
                  fontWeight: 700,
                  letterSpacing: "-0.025em",
                  color: "#1A1714",
                }}
              >
                Meet the team.
              </h2>
              <Link
                href="/agents"
                className="hidden sm:block"
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#6B6560",
                  textDecoration: "none",
                }}
              >
                See all →
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {previewWithStats.map(({ agent, stats }) => (
                <AgentMarketplaceCard
                  key={agent.id}
                  name={agent.name}
                  slug={agent.slug}
                  description={agent.description}
                  trustScore={agent.trustScore}
                  autonomyLevel={agent.autonomyLevel}
                  stats={{
                    totalTasks: stats.totalTasks,
                    approvalRate: stats.approvalRate,
                    lastActiveAt: stats.lastActiveAt?.toISOString() ?? null,
                  }}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Trust progression ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width">
          <p
            style={{
              marginBottom: "0.75rem",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "#9C958F",
            }}
          >
            Pricing
          </p>
          <h2
            style={{
              fontSize: "clamp(1.8rem, 3vw, 2.4rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "0.75rem",
            }}
          >
            Starts free. Earns its way up.
          </h2>
          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "#6B6560",
              maxWidth: "44ch",
              marginBottom: "3.5rem",
            }}
          >
            You only pay for what&rsquo;s working. Agents that underperform stay on free.
          </p>

          {/* Trust progression strip */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
            }}
          >
            {/* Connecting line */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "12.5%",
                right: "12.5%",
                height: "1px",
                background: "linear-gradient(to right, #DDD9D3, #A07850, #8B6540)",
                transform: "translateY(-50%)",
              }}
            />
            {TRUST_STEPS.map(({ score, label, accent }) => (
              <div
                key={score}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "0.625rem",
                  position: "relative",
                  zIndex: 1,
                }}
              >
                <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "#9C958F" }}>{label}</p>
                <div
                  style={{
                    width: "4rem",
                    height: "4rem",
                    borderRadius: "9999px",
                    background: `${accent}18`,
                    border: `1.5px solid ${accent}40`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "1rem",
                      fontWeight: 700,
                      color: accent,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {score}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "2.5rem" }}>
            <Link
              href="/pricing"
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "#A07850",
                textDecoration: "none",
              }}
            >
              See full pricing →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section style={{ background: "#EDEAE5", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <div className="page-width">
          <h2
            style={{
              fontSize: "clamp(2rem, 4vw, 3.2rem)",
              fontWeight: 700,
              letterSpacing: "-0.025em",
              color: "#1A1714",
              marginBottom: "1rem",
            }}
          >
            Ready to meet your team?
          </h2>
          <p style={{ fontSize: "1rem", color: "#6B6560", marginBottom: "2.5rem" }}>
            Join 200+ businesses on the early access list.
          </p>
          <Link
            href="/get-started"
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "#1A1714",
              color: "#F5F3F0",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get early access
          </Link>
        </div>
      </section>
    </>
  );
}
