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

    const { connections } = await client.getDeploymentConnections(id);

    return (
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <h1 className="font-display text-2xl text-foreground">{deployment.listingId}</h1>
        <DeploymentDetailClient deploymentId={id} connections={connections} />
      </div>
    );
  } catch {
    notFound();
  }
}
