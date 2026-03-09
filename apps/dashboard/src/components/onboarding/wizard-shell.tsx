"use client";

import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft } from "lucide-react";

const DEFAULT_STEP_LABELS = [
  "About your business",
  "How does your AI connect?",
  "How much oversight?",
  "Choose your first domain",
  "Connect your service",
  "You're ready",
];

interface WizardShellProps {
  step: number;
  stepLabels?: string[];
  onNext: () => void;
  onBack: () => void;
  canProceed: boolean;
  isSubmitting?: boolean;
  isLastStep?: boolean;
  onComplete?: () => void;
  children: ReactNode;
}

export function WizardShell({
  step,
  stepLabels = DEFAULT_STEP_LABELS,
  onNext,
  onBack,
  canProceed,
  isSubmitting,
  isLastStep,
  onComplete,
  children,
}: WizardShellProps) {
  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 content-width">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-8">
        <div className="space-y-3 mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Set up your assistant
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Step {step + 1} of {stepLabels.length}: {stepLabels[step]}
          </p>
          <div className="flex gap-1 pt-1">
            {stepLabels.map((_, i) => (
              <div
                key={i}
                className={`h-0.5 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary/80" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        {children}

        <div className="flex gap-2 mt-8">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={onBack}
              className="flex-1 min-h-[44px]"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          )}
          {isLastStep ? (
            <Button
              onClick={onComplete}
              className="flex-1 min-h-[44px]"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Setting up…" : "Finish"}
            </Button>
          ) : (
            <Button
              onClick={onNext}
              className="flex-1 min-h-[44px]"
              disabled={!canProceed}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
