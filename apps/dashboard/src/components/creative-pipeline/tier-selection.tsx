"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { useCostEstimate, useApproveStage } from "@/hooks/use-creative-pipeline";

interface TierSelectionProps {
  jobId: string;
}

const TIERS = [
  {
    id: "basic" as const,
    label: "Basic",
    description: "Raw AI-generated scene clips from Kling AI",
    features: ["Individual scene clips", "Direct Kling AI output", "Fastest turnaround"],
  },
  {
    id: "pro" as const,
    label: "Pro",
    description: "Assembled video with voiceover, captions, and text overlays",
    features: [
      "Assembled video per platform",
      "AI voiceover (ElevenLabs)",
      "Auto-generated captions",
      "Text overlays from storyboard",
      "Platform-optimized formats",
    ],
  },
];

export function TierSelection({ jobId }: TierSelectionProps) {
  const { toast } = useToast();
  const [selectedTier, setSelectedTier] = useState<"basic" | "pro">("basic");
  const { data: estimates, isLoading: estimatesLoading } = useCostEstimate(jobId, true);
  const approveMutation = useApproveStage();

  const handleStartProduction = () => {
    approveMutation.mutate(
      { jobId, action: "continue", productionTier: selectedTier },
      {
        onSuccess: () => {
          toast({
            title: "Production started",
            description: `Starting ${selectedTier} tier production.`,
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to start production. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-[15px] font-medium">Choose Production Tier</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TIERS.map((tier) => {
          const estimate = estimates?.[tier.id];
          const isSelected = selectedTier === tier.id;
          return (
            <button
              key={tier.id}
              onClick={() => setSelectedTier(tier.id)}
              className={`text-left p-4 rounded-lg border-2 transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[14px] font-medium">{tier.label}</span>
                {estimatesLoading ? (
                  <span className="text-[12px] text-muted-foreground">Loading...</span>
                ) : estimate ? (
                  <span className="text-[13px] font-medium text-primary">
                    ~${estimate.cost.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground">Estimate unavailable</span>
                )}
              </div>
              <p className="text-[12px] text-muted-foreground mb-2">{tier.description}</p>
              <ul className="space-y-0.5">
                {tier.features.map((f) => (
                  <li key={f} className="text-[11px] text-muted-foreground">
                    • {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            approveMutation.mutate(
              { jobId, action: "stop" },
              {
                onSuccess: () => toast({ title: "Pipeline stopped" }),
                onError: () =>
                  toast({
                    title: "Error",
                    description: "Failed to stop pipeline.",
                    variant: "destructive",
                  }),
              },
            );
          }}
          disabled={approveMutation.isPending}
        >
          Stop Pipeline
        </Button>
        <Button
          onClick={handleStartProduction}
          disabled={approveMutation.isPending}
          className="flex-1"
        >
          {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Start {selectedTier === "pro" ? "Pro" : "Basic"} Production
        </Button>
      </div>
    </div>
  );
}
