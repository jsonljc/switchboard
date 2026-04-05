"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DeployWizardShellProps {
  steps: string[];
  currentStep: number;
  canProceed: boolean;
  isSubmitting: boolean;
  onBack: () => void;
  onNext: () => void;
  onDeploy: () => void;
  children: React.ReactNode;
}

export function DeployWizardShell({
  steps,
  currentStep,
  canProceed,
  isSubmitting,
  onBack,
  onNext,
  onDeploy,
  children,
}: DeployWizardShellProps) {
  const isLast = currentStep === steps.length - 1;

  return (
    <div className="space-y-8">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 text-[13px]",
                i === currentStep
                  ? "text-foreground font-medium"
                  : i < currentStep
                    ? "text-positive"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-medium",
                  i === currentStep
                    ? "bg-foreground text-background"
                    : i < currentStep
                      ? "bg-positive/20 text-positive"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {i < currentStep ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn("h-px w-8 sm:w-12", i < currentStep ? "bg-positive/40" : "bg-border")}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div>{children}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border/60">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={currentStep === 0}
          className="text-[13px]"
        >
          Back
        </Button>
        {isLast ? (
          <Button onClick={onDeploy} disabled={!canProceed || isSubmitting} className="text-[13px]">
            {isSubmitting ? "Deploying..." : "Deploy Agent"}
          </Button>
        ) : (
          <Button onClick={onNext} disabled={!canProceed} className="text-[13px]">
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}
