"use client";

import { useState, useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import type { BusinessFacts } from "@switchboard/schemas";

export interface WizardStepProps {
  data: WizardData;
  onUpdate: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}

export interface WizardStep {
  id: string;
  label: string;
  component: React.ComponentType<WizardStepProps & Record<string, unknown>>;
  props?: Record<string, unknown>;
}

export interface PersonaInput {
  businessName: string;
  businessType: string;
  productService: string;
  valueProposition: string;
  tone: string;
  qualificationCriteria: Record<string, unknown>;
  disqualificationCriteria: Record<string, unknown>;
  escalationRules: Record<string, unknown>;
  bookingLink: string | null;
  customInstructions: string | null;
}

export interface ConnectionConfig {
  type: string;
  apiKey?: string;
  config?: Record<string, unknown>;
}

export interface WizardData {
  listingId: string;
  listingSlug: string;
  url?: string;
  persona?: PersonaInput;
  connections: Record<string, ConnectionConfig>;
  testChatVerified?: boolean;
  scannedProfile?: Record<string, unknown>;
  businessFacts?: BusinessFacts;
}

interface DeployWizardShellProps {
  steps: WizardStep[];
  initialData: Pick<WizardData, "listingId" | "listingSlug">;
  header?: ReactNode;
  onDataChange?: (data: WizardData) => void;
}

export function DeployWizardShell({
  steps,
  initialData,
  header,
  onDataChange,
}: DeployWizardShellProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<WizardData>({
    ...initialData,
    connections: {},
  });

  const handleUpdate = useCallback(
    (patch: Partial<WizardData>) => {
      setData((prev) => {
        const next = { ...prev, ...patch };
        onDataChange?.(next);
        return next;
      });
    },
    [onDataChange],
  );

  const handleNext = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const step = steps[currentStep];
  if (!step) return null;

  const StepComponent = step.component;

  return (
    <div className="max-w-xl mx-auto">
      {header}

      {/* Progress bar */}
      <div className="mb-8">
        <p className="text-[13px] text-muted-foreground mb-2">
          Step {currentStep + 1} of {steps.length}: {step.label}
        </p>
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step content */}
      <StepComponent
        data={data}
        onUpdate={handleUpdate}
        onNext={handleNext}
        {...(step.props ?? {})}
      />

      {/* Back button */}
      {currentStep > 0 && (
        <div className="mt-6">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
