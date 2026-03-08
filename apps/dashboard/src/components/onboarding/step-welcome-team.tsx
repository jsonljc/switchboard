"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AgentCard } from "@/components/team/agent-card";
import { Sparkles } from "lucide-react";
import type { AgentRosterEntry } from "@/lib/api-client";

interface StepWelcomeTeamProps {
  operatorName: string;
  roster: AgentRosterEntry[];
}

export function StepWelcomeTeam({ operatorName, roster }: StepWelcomeTeamProps) {
  const primaryOperator = roster.find((a) => a.agentRole === "primary_operator");
  const activeAgents = roster.filter(
    (a) => a.agentRole !== "primary_operator" && a.status === "active",
  );

  return (
    <div className="space-y-4">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center h-14 w-14 rounded-xl bg-primary/10 text-primary mx-auto">
          <Sparkles className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold">Meet your AI team</h3>
        <p className="text-sm text-muted-foreground">
          {operatorName} and the team are ready to start working for your business.
        </p>
      </div>

      {/* Primary Operator */}
      {primaryOperator && (
        <Card className="border-primary/20 bg-primary/[0.02]">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold">{primaryOperator.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  Your lead AI operator — coordinates everything.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Specialists */}
      {activeAgents.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {activeAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        More specialists unlock as you grow. You can manage your team anytime.
      </p>
    </div>
  );
}
