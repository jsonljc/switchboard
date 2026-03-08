"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useAgentRoster, useInitializeRoster } from "@/hooks/use-agents";
import { AgentCard } from "@/components/team/agent-card";
import { PrimaryOperatorCard } from "@/components/team/primary-operator-card";
import { AgentDetailSheet } from "@/components/team/agent-detail-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentRosterEntry } from "@/lib/api-client";

export default function TeamPage() {
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  const initializeRoster = useInitializeRoster();
  const [selectedAgent, setSelectedAgent] = useState<AgentRosterEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Lazy initialization: if no roster exists, create one
  useEffect(() => {
    if (!isLoading && rosterData && rosterData.roster.length === 0 && !initializeRoster.isPending) {
      initializeRoster.mutate();
    }
  }, [isLoading, rosterData, initializeRoster]);

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const roster = rosterData?.roster ?? [];
  const primaryOperator = roster.find((a) => a.agentRole === "primary_operator");
  const specialists = roster.filter((a) => a.agentRole !== "primary_operator");

  const handleAgentClick = (agent: AgentRosterEntry) => {
    setSelectedAgent(agent);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your AI Team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Meet the specialists that run your business operations.
        </p>
      </div>

      {/* Primary Operator */}
      {primaryOperator && <PrimaryOperatorCard agent={primaryOperator} />}

      {/* Specialist Grid */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {specialists.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onClick={() => handleAgentClick(agent)} />
        ))}
      </div>

      {/* Detail Sheet */}
      <AgentDetailSheet agent={selectedAgent} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
