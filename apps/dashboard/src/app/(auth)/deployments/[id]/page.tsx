import { redirect } from "next/navigation";
import { getApiClient } from "@/lib/get-api-client";

/**
 * Mapping from listing slug to module route slug.
 * Mirrors SLUG_TO_MODULE in the module status API route.
 */
const SLUG_TO_MODULE: Record<string, string> = {
  "alex-conversion": "lead-to-booking",
  "speed-to-lead": "lead-to-booking",
  "sales-closer": "lead-to-booking",
  "nurture-specialist": "lead-to-booking",
  "creative-family": "creative",
  "ad-optimizer": "ad-optimizer",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Legacy deployment detail URL — resolves the deployment's listing to a module
 * slug and redirects to /modules/[module]. Falls back to /dashboard.
 */
export default async function DeploymentRedirectPage({ params }: PageProps) {
  const { id } = await params;

  let moduleSlug: string | undefined;

  try {
    const client = await getApiClient();

    const [{ deployments }, { listings }] = await Promise.all([
      client.listDeployments(),
      client.listMarketplaceListings(),
    ]);

    const deployment = deployments.find((d) => d.id === id);
    if (deployment) {
      const listing = listings.find((l) => l.id === deployment.listingId);
      const slug = listing?.slug ?? deployment.listingId;
      moduleSlug = SLUG_TO_MODULE[slug];
    }
  } catch {
    // Resolution failed — fall through to dashboard redirect
  }

  redirect(moduleSlug ? `/modules/${moduleSlug}` : "/dashboard");
}
