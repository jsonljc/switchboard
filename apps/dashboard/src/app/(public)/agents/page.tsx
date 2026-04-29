import type { Metadata } from "next";
import Link from "next/link";
import { getListedAgents, getDemoTaskStats } from "@/lib/demo-data";
import { AgentMarketplaceCard } from "@/components/landing/agent-marketplace-card";
import { LandingChrome } from "@/components/landing/landing-chrome";

export const metadata: Metadata = {
  title: "Agents — Switchboard",
  description: "Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website.",
};

export default async function AgentCatalogPage() {
  const agents = await getListedAgents().catch(() => []);
  const withStats = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      stats: await getDemoTaskStats(agent.id).catch(() => ({
        totalTasks: 0,
        approvedCount: 0,
        approvalRate: 0,
        lastActiveAt: null,
      })),
    })),
  );

  return (
    <LandingChrome>
      {/* ── Hero ── */}
      <section style={{ background: "#F5F3F0", paddingTop: "8rem", paddingBottom: "4rem" }}>
        <div className="page-width">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
            }}
            className="sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
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
                Agent marketplace
              </p>
              <h1
                style={{
                  fontSize: "clamp(2.8rem, 5vw, 4.5rem)",
                  fontWeight: 700,
                  letterSpacing: "-0.028em",
                  lineHeight: 1.02,
                  color: "#1A1714",
                }}
              >
                Meet the team.
              </h1>
              <p
                style={{
                  marginTop: "1rem",
                  fontSize: "1.0625rem",
                  lineHeight: 1.6,
                  color: "#6B6560",
                  maxWidth: "44ch",
                }}
              >
                Purpose-built AI agents for growth. Each one does one job — and does it well.
              </p>
            </div>
            <Link
              href="/signup"
              style={{
                background: "#1A1714",
                color: "#F5F3F0",
                borderRadius: "9999px",
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
                alignSelf: "flex-start",
              }}
            >
              Get Started
            </Link>
          </div>
        </div>
      </section>

      {/* ── Agent grid ── */}
      <section style={{ background: "#EDEAE5", paddingTop: "3rem", paddingBottom: "5rem" }}>
        <div className="page-width">
          {withStats.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {withStats.map(({ agent, stats }) => (
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
          ) : (
            <div
              style={{
                padding: "4rem 2rem",
                textAlign: "center",
                background: "#F9F8F6",
                border: "1px solid #DDD9D3",
                borderRadius: "1rem",
              }}
            >
              <p
                style={{
                  fontSize: "1.0625rem",
                  fontWeight: 700,
                  color: "#1A1714",
                  marginBottom: "0.5rem",
                }}
              >
                No agents listed yet.
              </p>
              <p style={{ fontSize: "0.875rem", color: "#9C958F" }}>
                Run{" "}
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    background: "#EDEAE5",
                    padding: "0.125rem 0.375rem",
                    borderRadius: "0.25rem",
                  }}
                >
                  pnpm db:seed
                </code>{" "}
                to add demo agents.
              </p>
            </div>
          )}
        </div>
      </section>
    </LandingChrome>
  );
}
