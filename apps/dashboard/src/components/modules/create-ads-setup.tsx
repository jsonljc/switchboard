"use client";

import { useState } from "react";

type Step = "enable" | "first-job";

const STEPS: Step[] = ["enable", "first-job"];

interface CreateAdsSetupProps {
  initialStep?: string;
  onComplete: () => void;
  isPlatformBlocking?: boolean;
}

export function CreateAdsSetup({
  initialStep,
  onComplete,
  isPlatformBlocking,
}: CreateAdsSetupProps) {
  const [currentStep, setCurrentStep] = useState<Step>(
    STEPS.includes(initialStep as Step) ? (initialStep as Step) : "enable",
  );

  const currentIndex = STEPS.indexOf(currentStep);

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="flex gap-1.5">
        {STEPS.map((step, i) => (
          <div
            key={step}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= currentIndex ? "bg-foreground" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step: enable */}
      {currentStep === "enable" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Enable Create Ads</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Activate the creative pipeline to start generating ad content.
            </p>
          </div>
          {isPlatformBlocking && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-700 dark:text-yellow-400">
              This module requires platform credentials that are not yet configured. You can still
              enable it, but jobs will queue until credentials are provisioned.
            </div>
          )}
          <button
            type="button"
            onClick={() => setCurrentStep("first-job")}
            className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            Enable module
          </button>
        </div>
      )}

      {/* Step: first-job */}
      {currentStep === "first-job" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium">Submit your first job</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optionally kick off a guided creative job to see the pipeline in action.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            First job submission form will be rendered here
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onComplete}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onComplete}
              className="flex-1 rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
