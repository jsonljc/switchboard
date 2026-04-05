import { notFound } from "next/navigation";
import { getListingBySlug } from "@/lib/demo-data";
import { DeployWizard } from "@/components/marketplace/deploy-wizard";
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

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <DeployWizard
        agentName={displayName}
        bundleSlug={slug}
        roleFocus={ROLE_MAP[slug] ?? "default"}
      />
    </div>
  );
}
