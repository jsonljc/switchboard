import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getListingBySlug,
  getDemoTasks,
  getDemoTaskStats,
  getTrustRecords,
  getTrustProgression,
} from "@/lib/demo-data";
import { AgentProfileHeader } from "@/components/marketplace/agent-profile-header";
import { AgentProfileTabs } from "./profile-tabs";
import type { RoleFocus } from "@/components/character/operator-character";

const ROLE_MAP: Record<string, RoleFocus> = {
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) return { title: "Agent Not Found — Switchboard" };
  return {
    title: `${listing.name} — Switchboard`,
    description: listing.description,
  };
}

export default async function AgentProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const [tasks, stats, trustRecords, trustProgression] = await Promise.all([
    getDemoTasks(listing.id, 30),
    getDemoTaskStats(listing.id),
    getTrustRecords(listing.id),
    getTrustProgression(listing.id),
  ]);

  const metadata = listing.metadata as Record<string, unknown> | null;
  const bundleSlug = (metadata?.bundleSlug as string) ?? "sales-pipeline-bundle";
  const roleFocus = ROLE_MAP[slug] ?? ("default" as RoleFocus);

  // Trust breakdown for chart
  const totalApprovals = trustRecords.reduce((sum, r) => sum + r.totalApprovals, 0);
  const totalRejections = trustRecords.reduce((sum, r) => sum + r.totalRejections, 0);
  const currentStreak = trustRecords.reduce((sum, r) => sum + r.consecutiveApprovals, 0);
  const highestScore = Math.max(...trustProgression.map((p) => p.score), 0);

  // Serialize tasks for client component
  const serializedTasks = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    output: t.output as Record<string, unknown> | null,
  }));

  return (
    <div className="pt-28 pb-20">
      <div className="page-width max-w-3xl mx-auto">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors mb-8 inline-block"
        >
          &larr; Back to marketplace
        </Link>

        <AgentProfileHeader
          name={listing.name}
          slug={listing.slug}
          description={listing.description}
          trustScore={listing.trustScore}
          autonomyLevel={listing.autonomyLevel}
          roleFocus={roleFocus}
          bundleSlug={bundleSlug}
        />

        <div className="border-t border-border mt-10 pt-8">
          <AgentProfileTabs
            tasks={serializedTasks}
            stats={{
              totalTasks: stats.totalTasks,
              approvedCount: stats.approvedCount,
              approvalRate: stats.approvalRate,
              lastActiveAt: stats.lastActiveAt?.toISOString() ?? null,
            }}
            trustProgression={trustProgression}
            trustBreakdown={{
              totalApprovals,
              totalRejections,
              currentStreak,
              highestScore,
            }}
            agentSlug={slug}
            bundleSlug={bundleSlug}
          />
        </div>
      </div>
    </div>
  );
}
