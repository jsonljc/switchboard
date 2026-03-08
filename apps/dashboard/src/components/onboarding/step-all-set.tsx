"use client";

import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepAllSetProps {
  businessName: string;
  organizationId: string;
  isHandoffTriggered: boolean;
  isHandoffLoading: boolean;
  onTriggerHandoff: () => void;
}

export function StepAllSet({
  businessName,
  organizationId,
  isHandoffTriggered,
  isHandoffLoading,
  onTriggerHandoff,
}: StepAllSetProps) {
  const botDeepLink = `https://t.me/SwitchboardBot?start=org_${organizationId}`;

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">You&apos;re all set!</h3>
        <p className="text-sm text-muted-foreground">
          Your AI operator is now connected to {businessName || "your business"}. It will analyze
          your ad account and send you a campaign plan on Telegram within the next few hours.
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3 text-left">
        <p className="text-sm font-medium">What happens next:</p>
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
              1
            </span>
            <span className="text-muted-foreground">
              Your operator analyzes your current ad campaigns
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
              2
            </span>
            <span className="text-muted-foreground">
              It creates an optimization plan based on your business type
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
              3
            </span>
            <span className="text-muted-foreground">
              The plan is sent to your Telegram for review and approval
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
              4
            </span>
            <span className="text-muted-foreground">
              From then on, everything happens through Telegram
            </span>
          </div>
        </div>
      </div>

      {!isHandoffTriggered ? (
        <Button
          onClick={onTriggerHandoff}
          disabled={isHandoffLoading}
          className="w-full min-h-[44px]"
        >
          {isHandoffLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting analysis...
            </span>
          ) : (
            "Start Campaign Analysis"
          )}
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            Analysis started! Check Telegram for updates.
          </div>
          <Button
            variant="outline"
            className="w-full min-h-[44px]"
            onClick={() => window.open(botDeepLink, "_blank")}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Telegram
          </Button>
        </div>
      )}
    </div>
  );
}
