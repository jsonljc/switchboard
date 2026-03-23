"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MessageSquare, Target, BellRing, TrendingUp, Zap } from "lucide-react";
import { getPreviewMessage } from "@/components/team/agent-preview-templates.js";

interface StepAgentStyleProps {
  selectedAgents: string[];
  agentTones: Record<string, string>;
  onTonesChange: (tones: Record<string, string>) => void;
  businessName: string;
}

const AGENT_META: Record<
  string,
  { label: string; description: string; icon: typeof MessageSquare }
> = {
  "lead-responder": {
    label: "Lead Responder",
    description: "First point of contact for new leads",
    icon: MessageSquare,
  },
  "sales-closer": {
    label: "Sales Closer",
    description: "Converts qualified leads into bookings",
    icon: Target,
  },
  nurture: {
    label: "Nurture",
    description: "Follow-ups, reminders, and winbacks",
    icon: BellRing,
  },
  "revenue-tracker": {
    label: "Revenue Tracker",
    description: "Attributes revenue to ad campaigns",
    icon: TrendingUp,
  },
  "ad-optimizer": {
    label: "Ad Optimizer",
    description: "Adjusts ad spend based on performance",
    icon: Zap,
  },
};

const TONES = [
  { id: "warm-professional", short: "Warm", label: "Warm & Professional" },
  { id: "casual-conversational", short: "Casual", label: "Casual & Conversational" },
  { id: "direct-efficient", short: "Direct", label: "Direct & Efficient" },
];

export function StepAgentStyle({
  selectedAgents,
  agentTones,
  onTonesChange,
  businessName,
}: StepAgentStyleProps) {
  const setTone = (agentId: string, toneId: string) => {
    onTonesChange({ ...agentTones, [agentId]: toneId });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-base">How should each agent sound?</Label>
        <p className="text-[13px] text-muted-foreground">
          Pick a tone for each team member. You'll see a preview of how they'll greet customers.
        </p>
      </div>

      <div className="space-y-3">
        {selectedAgents.map((agentId) => {
          const meta = AGENT_META[agentId];
          if (!meta) return null;
          const Icon = meta.icon;
          const selectedTone = agentTones[agentId];

          return (
            <Card key={agentId} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{meta.label}</p>
                    <p className="text-[12px] text-muted-foreground">{meta.description}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {TONES.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => setTone(agentId, tone.id)}
                      className={cn(
                        "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border",
                        selectedTone === tone.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent text-muted-foreground border-border hover:border-primary/30",
                      )}
                    >
                      {tone.short}
                    </button>
                  ))}
                </div>

                {selectedTone && (
                  <div className="rounded-md bg-muted/50 p-3 border border-border/50">
                    <p className="text-[12px] text-muted-foreground mb-1">Preview</p>
                    <p className="text-[13px] text-foreground italic">
                      {getPreviewMessage(agentId, selectedTone, {}, businessName)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
