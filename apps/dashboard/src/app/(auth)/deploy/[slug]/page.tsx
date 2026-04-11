import { notFound } from "next/navigation";
import { getListingBySlug } from "@/lib/demo-data";
import { DeployWizardClient } from "./deploy-wizard-client";
import type { RoleFocus } from "@/components/character/operator-character";

const ROLE_MAP: Record<string, RoleFocus> = {
  "sales-pipeline-bundle": "leads",
  "speed-to-lead": "leads",
  "sales-closer": "growth",
  "nurture-specialist": "care",
};

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function DeployPage({ params }: PageProps) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);
  if (!listing) notFound();

  const displayName = listing.name.replace(" Bundle", "");

  const metadata = listing.metadata as Record<string, unknown> | null;
  const connections = Array.isArray(metadata?.connections)
    ? (metadata.connections as Array<{ type: string; reason: string }>)
    : [];
  const setupSchema = (listing.metadata as Record<string, unknown> | null)?.setupSchema ?? null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <DeployWizardClient
        listingId={listing.id}
        listingSlug={slug}
        agentName={displayName}
        roleFocus={ROLE_MAP[slug] ?? "default"}
        connections={connections}
        setupSchema={setupSchema}
      />
    </div>
  );
}
