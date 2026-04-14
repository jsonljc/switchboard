import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { DeploymentDetailClient } from "./deployment-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeploymentDetailPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => d.id === id);
    if (!deployment) notFound();

    const [{ connections }, listingResult, trustResult] = await Promise.all([
      client.getDeploymentConnections(id),
      client.getMarketplaceListing(deployment.listingId).catch(() => null),
      client.getListingTrustScore(deployment.listingId).catch(() => null),
    ]);

    return (
      <DeploymentDetailClient
        deploymentId={id}
        listingId={deployment.listingId}
        connections={connections}
        listing={listingResult?.listing ?? null}
        trustBreakdown={trustResult}
        inputConfig={(deployment.inputConfig as Record<string, unknown>) ?? {}}
      />
    );
  } catch {
    notFound();
  }
}
