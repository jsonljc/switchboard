"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, MessageCircle, Phone, Loader2, PartyPopper } from "lucide-react";
import type { ChannelConfig } from "@/app/(auth)/onboarding/page";

interface StepReviewLaunchProps {
  businessName: string;
  selectedAgents: string[];
  agentTones: Record<string, string>;
  channels: ChannelConfig;
  launchStatus: "idle" | "launching" | "done";
}

const AGENT_ICONS: Record<string, typeof MessageSquare> = {
  creative: MessageSquare,
};

const AGENT_LABELS: Record<string, string> = {
  creative: "AI Creative",
};

const TONE_LABELS: Record<string, string> = {
  "warm-professional": "Warm & Professional",
  "casual-conversational": "Casual & Conversational",
  "direct-efficient": "Direct & Efficient",
};

export function StepReviewLaunch({
  businessName,
  selectedAgents,
  agentTones,
  channels,
  launchStatus,
}: StepReviewLaunchProps) {
  if (launchStatus === "done") {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="flex justify-center">
          <PartyPopper className="h-12 w-12 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Your team is ready!</h2>
        <p className="text-muted-foreground text-sm">
          {businessName}'s agents are configured and listening. You'll be redirected to your
          dashboard in a moment.
        </p>
      </div>
    );
  }

  if (launchStatus === "launching") {
    return (
      <div className="text-center space-y-4 py-8">
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <p className="text-sm text-muted-foreground">Setting up your team...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Meet the {businessName} team</h2>
        <p className="text-[13px] text-muted-foreground">
          Here's your lineup. Hit Finish to launch.
        </p>
      </div>

      {/* Agent roster */}
      <div className="space-y-2">
        {selectedAgents.map((agentId) => {
          const Icon = AGENT_ICONS[agentId] ?? MessageSquare;
          const label = AGENT_LABELS[agentId] ?? agentId;
          const toneLabel = TONE_LABELS[agentTones[agentId] ?? ""] ?? "Default";

          return (
            <Card key={agentId}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                </div>
                <span className="text-[12px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {toneLabel}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Channel summary */}
      <div className="rounded-lg border p-4 space-y-2">
        <p className="text-sm font-medium">Channels</p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {channels.founderChannel === "telegram" ? (
            <MessageCircle className="h-4 w-4" />
          ) : (
            <Phone className="h-4 w-4" />
          )}
          <span>You: {channels.founderChannel === "telegram" ? "Telegram" : "WhatsApp"}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-4 w-4" />
          <span>Customers: WhatsApp</span>
        </div>
      </div>
    </div>
  );
}
