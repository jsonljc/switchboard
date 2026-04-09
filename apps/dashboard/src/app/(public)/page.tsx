import type { Metadata } from "next";
import { getListedAgents, getBundleListings, getDemoTaskStats } from "@/lib/demo-data";
import { CategoryTabs } from "@/components/landing/category-tabs";
import { TeamBundleCard } from "@/components/landing/team-bundle-card";
import { AgentMarketplaceCard } from "@/components/landing/agent-marketplace-card";
import type { RoleFocus } from "@/components/character/operator-character";

export const metadata: Metadata = {
  title: "Switchboard — Meet your team",
  description:
    "Browse AI agents for your business. Deploy them in minutes. They earn your trust over time.",
};

const AGENT_BUNDLE_ORDER = [
  { slug: "speed-to-lead", roleFocus: "leads" as RoleFocus, roleLabel: "qualifies" },
  { slug: "sales-closer", roleFocus: "growth" as RoleFocus, roleLabel: "closes" },
  { slug: "nurture-specialist", roleFocus: "care" as RoleFocus, roleLabel: "re-engages" },
];

export default async function MarketplacePage() {
  const [agents, families] = await Promise.all([getListedAgents(), getBundleListings()]);

  // Get stats for each agent
  const agentStats = await Promise.all(
    agents.map(async (agent) => ({
      agent,
      stats: await getDemoTaskStats(agent.id),
    })),
  );

  // Compute bundle stats from individual agent stats
  const totalLeads = agentStats
    .filter((a) => a.agent.slug === "speed-to-lead")
    .reduce((sum, a) => sum + a.stats.totalTasks, 0);
  const totalBooked = agentStats
    .filter((a) => a.agent.slug === "sales-closer")
    .reduce((sum, a) => sum + a.stats.approvedCount, 0);

  // Build bundle agents array
  const bundleAgents = AGENT_BUNDLE_ORDER.map((order) => {
    const agent = agents.find((a) => a.slug === order.slug);
    return {
      name: agent?.name ?? order.slug,
      slug: order.slug,
      roleFocus: order.roleFocus,
      roleLabel: order.roleLabel,
    };
  });

  return (
    <section className="pt-28 pb-20 lg:pt-36 lg:pb-28" aria-label="Marketplace">
      <div className="page-width">
        {/* Hero */}
        <div className="text-center mb-12 lg:mb-16">
          <h1
            className="font-display font-light tracking-tight text-foreground"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
          >
            Meet your team.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Browse AI agents. Deploy them to your business. They earn your trust over time.
          </p>
        </div>

        {/* Category tabs + content */}
        <CategoryTabs families={families} activeFamily="sales">
          {/* Sales tab content */}
          <div className="mt-8 space-y-8">
            {/* Featured bundle */}
            <TeamBundleCard
              agents={bundleAgents}
              stats={{ leads: totalLeads, callsBooked: totalBooked, errors: 0 }}
            />

            {/* Individual agent cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agentStats.map(({ agent, stats }, i) => {
                const order = AGENT_BUNDLE_ORDER.find((o) => o.slug === agent.slug);
                const metadata = agent.metadata as Record<string, unknown> | null;
                return (
                  <AgentMarketplaceCard
                    key={agent.id}
                    name={agent.name}
                    slug={agent.slug}
                    description={agent.description}
                    trustScore={agent.trustScore}
                    autonomyLevel={agent.autonomyLevel}
                    roleFocus={order?.roleFocus ?? "default"}
                    bundleSlug={(metadata?.bundleSlug as string) ?? "sales-pipeline-bundle"}
                    stats={{
                      totalTasks: stats.totalTasks,
                      approvalRate: stats.approvalRate,
                      lastActiveAt: stats.lastActiveAt?.toISOString() ?? null,
                    }}
                    animationDelay={i * 150}
                  />
                );
              })}
            </div>
          </div>
        </CategoryTabs>

        {/* Empty state fallback */}
        {agents.length === 0 && (
          <p className="text-center text-muted-foreground mt-12">
            No agents available yet. Run <code className="font-mono">pnpm db:seed</code> to populate
            the marketplace.
          </p>
        )}
      </div>
    </section>
  );
}
