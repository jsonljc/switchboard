import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { MyAgentClient } from "./my-agent-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MyAgentPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => d.id === id);
    if (!deployment) notFound();

    const [{ connections }, listingResult, trustResult, tasksResult] = await Promise.all([
      client.getDeploymentConnections(id),
      client.getMarketplaceListing(deployment.listingId).catch(() => null),
      client.getListingTrustScore(deployment.listingId).catch(() => null),
      client.listTasks({ deploymentId: id }).catch(() => ({ tasks: [] })),
    ]);

    const listing = listingResult?.listing ?? null;

    // Resolve onboarding config from listing.metadata.setupSchema.onboarding
    const setupSchema =
      listing?.metadata &&
      typeof listing.metadata.setupSchema === "object" &&
      listing.metadata.setupSchema !== null
        ? (listing.metadata.setupSchema as Record<string, unknown>)
        : null;

    const onboarding =
      setupSchema && typeof setupSchema.onboarding === "object" && setupSchema.onboarding !== null
        ? (setupSchema.onboarding as {
            publicChannels?: boolean;
            privateChannel?: boolean;
            integrations?: string[];
          })
        : { publicChannels: false, privateChannel: false, integrations: [] };

    const chatServerUrl =
      process.env.NEXT_PUBLIC_CHAT_SERVER_URL ??
      process.env.NEXT_PUBLIC_CHAT_URL ??
      "http://localhost:3001";

    // Try to get the widget token from connections metadata
    const widgetConnection = connections.find(
      (c) => c.type === "web_widget" && c.status === "active",
    );
    const widgetToken =
      typeof widgetConnection?.metadata?.token === "string" ? widgetConnection.metadata.token : id; // fallback: use deploymentId as placeholder

    return (
      <MyAgentClient
        deploymentId={id}
        deployment={deployment}
        listing={listing}
        connections={connections}
        trustBreakdown={trustResult}
        initialTasks={tasksResult.tasks}
        onboarding={onboarding}
        chatServerUrl={chatServerUrl}
        widgetToken={widgetToken}
      />
    );
  } catch {
    notFound();
  }
}
