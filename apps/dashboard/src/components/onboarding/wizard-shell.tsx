"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Get Started</CardTitle>
          <CardDescription>
            Step {step + 1} of {stepLabels.length}: {stepLabels[step]}
          </CardDescription>
          <div className="flex gap-1 mt-2">
            {stepLabels.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {children}

          <div className="flex gap-2 mt-6">
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
                {isSubmitting ? "Setting up..." : "Complete Setup"}
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
        </CardContent>
      </Card>
    </div>
  );
}
