import { getApiClient } from "@/lib/get-api-client";
import { notFound } from "next/navigation";
import { CreativeJobDetailClient } from "./creative-job-detail-client";

interface PageProps {
  params: Promise<{ id: string; jobId: string }>;
}

export default async function CreativeJobDetailPage({ params }: PageProps) {
  const { id: deploymentId, jobId } = await params;

  try {
    const client = await getApiClient();
    const { job } = await client.getCreativeJob(jobId);
    if (!job) notFound();
    return <CreativeJobDetailClient deploymentId={deploymentId} initialJob={job} />;
  } catch {
    notFound();
  }
}
