"use client";

import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MessageSquare, Target, BellRing, TrendingUp, Zap, Check } from "lucide-react";

interface StepAgentSelectionProps {
  selected: string[];
  onSelectionChange: (agents: string[]) => void;
}

const AGENTS = [
  {
    id: "lead-responder",
    label: "Lead Responder",
    description: "Qualifies inbound leads via WhatsApp conversation",
    icon: MessageSquare,
    recommended: true,
  },
  {
    id: "sales-closer",
    label: "Sales Closer",
    description: "Converts qualified leads into bookings",
    icon: Target,
    recommended: true,
  },
  {
    id: "nurture",
    label: "Nurture",
    description: "Reminders, winbacks, and review requests",
    icon: BellRing,
    recommended: false,
  },
  {
    id: "revenue-tracker",
    label: "Revenue Tracker",
    description: "Attributes revenue to ad campaigns",
    icon: TrendingUp,
    recommended: false,
  },
  {
    id: "ad-optimizer",
    label: "Ad Optimizer",
    description: "Adjusts ad spend and pauses failing campaigns",
    icon: Zap,
    recommended: false,
  },
];

export function StepAgentSelection({ selected, onSelectionChange }: StepAgentSelectionProps) {
  const toggleAgent = (agentId: string) => {
    if (selected.includes(agentId)) {
      onSelectionChange(selected.filter((id) => id !== agentId));
    } else {
      onSelectionChange([...selected, agentId]);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Which agents would you like to activate?</Label>
        <p className="text-[13px] text-muted-foreground">
          You can always enable or disable agents later from the dashboard
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {AGENTS.map((agent) => {
          const Icon = agent.icon;
          const isSelected = selected.includes(agent.id);
          return (
            <Card
              key={agent.id}
              className={cn(
                "cursor-pointer transition-all",
                isSelected
                  ? "border-foreground/60 bg-surface shadow-sm"
                  : "hover:bg-surface hover:border-border-subtle",
              )}
              onClick={() => toggleAgent(agent.id)}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div
                  className={cn(
                    "flex items-center justify-center h-9 w-9 rounded-lg flex-shrink-0 mt-0.5",
                    isSelected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{agent.label}</p>
                    {agent.recommended && (
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        RECOMMENDED
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-muted-foreground mt-1">{agent.description}</p>
                </div>
                <div
                  className={cn(
                    "h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-1",
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/30 bg-transparent",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
