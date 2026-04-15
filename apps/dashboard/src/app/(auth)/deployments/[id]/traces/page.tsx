import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { TracesClient } from "./traces-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TracesPage({ params }: PageProps) {
  const { id } = await params;

  try {
    const client = await getApiClient();
    const { deployments } = await client.listDeployments();
    const deployment = deployments.find((d) => d.id === id);
    if (!deployment) notFound();

    return <TracesClient deploymentId={id} />;
  } catch {
    notFound();
  }
}
