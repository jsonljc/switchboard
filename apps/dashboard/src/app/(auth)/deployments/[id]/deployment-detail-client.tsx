"use client";

import { useRouter } from "next/navigation";
import { ChannelsSection } from "@/components/marketplace/channels-section";

interface Connection {
  id: string;
  type: string;
  status: string;
  metadata?: Record<string, unknown>;
}

interface DeploymentDetailClientProps {
  deploymentId: string;
  connections: Connection[];
}

export function DeploymentDetailClient({ deploymentId, connections }: DeploymentDetailClientProps) {
  const router = useRouter();

  return (
    <ChannelsSection
      deploymentId={deploymentId}
      connections={connections}
      onRefresh={() => router.refresh()}
    />
  );
}
