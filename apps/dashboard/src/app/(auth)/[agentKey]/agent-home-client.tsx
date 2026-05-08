"use client";

import type { AgentKey } from "@switchboard/schemas";
import { AgentBlockBoundary } from "@/components/agent-home/agent-block-boundary";
import { GreetingBlock } from "@/components/agent-home/greeting-block";
import { NeedsYouBlock } from "@/components/agent-home/needs-you-block";
import { WinsBlock } from "@/components/agent-home/wins-block";
import { MetricsBlock } from "@/components/agent-home/metrics-block";
import { PipelineBlock } from "@/components/agent-home/pipeline-block";
import { useAgentGreeting } from "@/hooks/use-agent-greeting";
import { useAgentWins } from "@/hooks/use-agent-wins";
import { useAgentMetrics } from "@/hooks/use-agent-metrics";
import { useAgentPipeline } from "@/hooks/use-agent-pipeline";

export function AgentHomeClient({ agentKey }: { agentKey: AgentKey }) {
  const greeting = useAgentGreeting(agentKey);
  const wins = useAgentWins(agentKey);
  const metrics = useAgentMetrics(agentKey);
  const pipeline = useAgentPipeline(agentKey);

  if (!greeting.data || !wins.data || !metrics.data || !pipeline.data) return null;

  return (
    <>
      <AgentBlockBoundary key={`${agentKey}-greeting`}>
        <GreetingBlock vm={greeting.data} agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-needs-you`}>
        <NeedsYouBlock agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-wins`}>
        <WinsBlock vm={wins.data} agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-metrics`}>
        <MetricsBlock vm={metrics.data} agentKey={agentKey} />
      </AgentBlockBoundary>
      <AgentBlockBoundary key={`${agentKey}-pipeline`}>
        <PipelineBlock vm={pipeline.data} />
      </AgentBlockBoundary>
    </>
  );
}
