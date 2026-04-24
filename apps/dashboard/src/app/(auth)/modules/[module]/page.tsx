import { notFound, redirect } from "next/navigation";
import { getApiClient } from "@/lib/get-api-client";
import { MODULE_IDS, MODULE_LABELS, SLUG_TO_MODULE } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";
import { ModuleDetailClient } from "@/components/modules/module-detail";

interface PageProps {
  params: Promise<{ module: string }>;
}

export default async function ModuleDetailPage({ params }: PageProps) {
  const { module: moduleSlug } = await params;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  const moduleId = moduleSlug as ModuleId;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => {
      if (d.listingId === moduleId || d.id === moduleId) return true;
      const mapped = SLUG_TO_MODULE[d.listingId];
      return mapped === moduleId;
    });

    if (!deployment) {
      redirect(`/modules/${moduleId}/setup`);
    }

    const [connectionsResult, trustResult] = await Promise.all([
      client.getDeploymentConnections(deployment.id).catch(() => ({ connections: [] })),
      client.getListingTrustScore(deployment.listingId).catch(() => null),
    ]);

    return (
      <ModuleDetailClient
        moduleId={moduleId}
        label={MODULE_LABELS[moduleId]}
        deploymentId={deployment.id}
        orgId={deployment.organizationId}
        listingId={deployment.listingId}
        connections={connectionsResult.connections ?? []}
        trustBreakdown={trustResult}
        inputConfig={(deployment.inputConfig as Record<string, unknown>) ?? {}}
      />
    );
  } catch {
    notFound();
  }
}
