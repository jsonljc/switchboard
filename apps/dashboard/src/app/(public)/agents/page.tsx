import type { Metadata } from "next";
import Link from "next/link";
import { getListedAgents, getDemoTaskStats } from "@/lib/demo-data";
import { AgentMarketplaceCard } from "@/components/landing/agent-marketplace-card";
import type { RoleFocus } from "@/components/character/operator-character";

export const metadata: Metadata = {
  title: "Agents — Switchboard",
  description: "Browse AI agents built for growth. Deploy to WhatsApp, Telegram, or your website.",
};

const ROLE_MAP: Record<string, RoleFocus> = {
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

export default async function AgentCatalogPage() {
  const agents = await getListedAgents();
  const withStats = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      stats: await getDemoTaskStats(agent.id),
    })),
  );

  return (
    <>
      {/* ── Hero ── */}
      <section className="pb-12 pt-28" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p
                className="mb-3 text-xs font-medium uppercase tracking-widest"
                style={{ color: "hsl(30 55% 46%)", letterSpacing: "0.14em" }}
              >
                Agent marketplace
              </p>
              <h1
                className="font-display font-light"
                style={{
                  fontSize: "clamp(2.4rem, 4.5vw, 4rem)",
                  letterSpacing: "-0.025em",
                  lineHeight: 1.06,
                  color: "hsl(30 8% 10%)",
                }}
              >
                Meet the team.
              </h1>
              <p className="mt-3 text-base" style={{ color: "hsl(30 5% 46%)", maxWidth: "44ch" }}>
                Every agent is built for a specific outcome. Browse by what you need, not by
                features.
              </p>
            </div>
            <Link
              href="/get-started"
              className="flex-shrink-0 self-start rounded-full px-6 py-3 text-sm font-medium sm:self-auto"
              style={{ background: "hsl(30 55% 46%)", color: "white" }}
            >
              Get early access
            </Link>
          </div>
        </div>
      </section>

      {/* ── Agent grid ── */}
      <section className="py-12" style={{ background: "hsl(45 25% 98%)" }}>
        <div className="page-width">
          {withStats.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {withStats.map(({ agent, stats }, i) => {
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
                    animationDelay={i * 100}
                  />
                );
              })}
            </div>
          ) : (
            <div className="py-24 text-center">
              <p style={{ color: "hsl(30 5% 52%)" }}>
                No agents listed yet.{" "}
                <code
                  className="rounded px-1.5 py-0.5 text-xs"
                  style={{ background: "hsl(40 15% 93%)" }}
                >
                  pnpm db:seed
                </code>{" "}
                to populate the marketplace.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section
        className="py-20"
        style={{ background: "hsl(40 20% 96%)", borderTop: "1px solid hsl(35 12% 90%)" }}
      >
        <div className="page-width text-center">
          <p
            className="mb-6 font-display text-xl font-light"
            style={{ color: "hsl(30 8% 20%)", letterSpacing: "-0.01em" }}
          >
            Don&rsquo;t see what you need?
          </p>
          <a
            href="mailto:builders@switchboard.ai"
            className="text-sm font-medium transition-colors"
            style={{ color: "hsl(30 45% 45%)" }}
          >
            Build an agent for the marketplace →
          </a>
        </div>
      </section>
    </>
  );
}
