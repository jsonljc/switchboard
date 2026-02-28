"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusiness } from "@/components/onboarding/step-business";
import { StepRuntime } from "@/components/onboarding/step-runtime";
import { StepGovernance } from "@/components/onboarding/step-governance";
import { StepCartridge } from "@/components/onboarding/step-cartridge";
import { StepConnection } from "@/components/onboarding/step-connection";
import { StepComplete } from "@/components/onboarding/step-complete";

// Governance profile presets (mirrors @switchboard/core governance-presets.ts)
const PROFILE_PRESETS: Record<string, {
  riskTolerance: Record<string, string>;
  spendLimits: Record<string, number | null>;
}> = {
  observe: {
    riskTolerance: { none: "none", low: "none", medium: "none", high: "none", critical: "none" },
    spendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
  },
  guarded: {
    riskTolerance: { none: "none", low: "none", medium: "standard", high: "elevated", critical: "mandatory" },
    spendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
  },
  strict: {
    riskTolerance: { none: "none", low: "standard", medium: "elevated", high: "mandatory", critical: "mandatory" },
    spendLimits: { daily: 5000, weekly: 20000, monthly: 50000, perAction: 1000 },
  },
  locked: {
    riskTolerance: { none: "mandatory", low: "mandatory", medium: "mandatory", high: "mandatory", critical: "mandatory" },
    spendLimits: { daily: 0, weekly: 0, monthly: 0, perAction: 0 },
  },
};

const TOTAL_STEPS = 6;

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [runtimeType, setRuntimeType] = useState("http");
  const [governanceProfile, setGovernanceProfile] = useState("guarded");
  const [cartridgeId, setCartridgeId] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);

  if (status === "unauthenticated") redirect("/login");

  const organizationId = (session as any)?.organizationId ?? "";
  const principalId = (session as any)?.principalId ?? "";

  // Incremental persistence: save each step's data independently
  const saveStep = async (stepIndex: number) => {
    try {
      if (stepIndex === 0 && businessName) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: businessName }),
        });
      } else if (stepIndex === 1) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runtimeType }),
        });
      } else if (stepIndex === 2) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ governanceProfile }),
        });
      }
    } catch {
      // Silently continue — data will be saved on complete
    }
  };

  const handleNext = async () => {
    await saveStep(step);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const canProceed = (() => {
    switch (step) {
      case 0: return businessName.trim().length > 0;
      case 1: return runtimeType !== "";
      case 2: return governanceProfile !== "";
      case 3: return cartridgeId !== "";
      case 4: return true; // Connection step is skippable
      case 5: return true;
      default: return false;
    }
  })();

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // 1. Finalize org config
      await fetch("/api/dashboard/organizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName,
          runtimeType,
          governanceProfile,
          onboardingComplete: true,
        }),
      });

      // 2. Create IdentitySpec with governance profile preset
      const preset = PROFILE_PRESETS[governanceProfile];
      if (preset) {
        await fetch("/api/dashboard/identity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            principalId,
            organizationId,
            name: businessName,
            description: `AI agent for ${businessName}`,
            riskTolerance: preset.riskTolerance,
            globalSpendLimits: preset.spendLimits,
            cartridgeSpendLimits: {},
            forbiddenBehaviors: [],
            trustBehaviors: [],
          }),
        });
      }

      router.push("/");
    } catch (err: any) {
      toast({
        title: "Setup failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <WizardShell
      step={step}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed}
      isSubmitting={isSubmitting}
      isLastStep={step === TOTAL_STEPS - 1}
      onComplete={handleComplete}
    >
      {step === 0 && (
        <StepBusiness businessName={businessName} onChange={setBusinessName} />
      )}
      {step === 1 && (
        <StepRuntime selected={runtimeType} onChange={setRuntimeType} />
      )}
      {step === 2 && (
        <StepGovernance selected={governanceProfile} onChange={setGovernanceProfile} />
      )}
      {step === 3 && (
        <StepCartridge selected={cartridgeId} onChange={setCartridgeId} />
      )}
      {step === 4 && (
        <StepConnection
          cartridgeId={cartridgeId}
          onConnectionCreated={setConnectionId}
        />
      )}
      {step === 5 && (
        <StepComplete
          businessName={businessName}
          runtimeType={runtimeType}
          governanceProfile={governanceProfile}
          cartridgeId={cartridgeId}
          organizationId={organizationId}
        />
      )}
    </WizardShell>
  );
}
