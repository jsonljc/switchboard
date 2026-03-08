"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusinessType } from "@/components/onboarding/step-business-type";
import { StepOperator } from "@/components/onboarding/step-operator";
import { StepGovernanceSimple } from "@/components/onboarding/step-governance-simple";
import { StepConnection } from "@/components/onboarding/step-connection";
import { StepWelcomeTeam } from "@/components/onboarding/step-welcome-team";
import { SKIN_CATALOG } from "@/lib/skin-catalog";
import type { AgentRosterEntry } from "@/lib/api-client";

const PROFILE_PRESETS: Record<
  string,
  {
    riskTolerance: Record<string, string>;
    spendLimits: Record<string, number | null>;
    forbiddenBehaviors: string[];
    trustBehaviors: string[];
  }
> = {
  guarded: {
    riskTolerance: {
      none: "none",
      low: "none",
      medium: "standard",
      high: "elevated",
      critical: "mandatory",
    },
    spendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  strict: {
    riskTolerance: {
      none: "none",
      low: "standard",
      medium: "elevated",
      high: "mandatory",
      critical: "mandatory",
    },
    spendLimits: { daily: 5000, weekly: 20000, monthly: 50000, perAction: 1000 },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  locked: {
    riskTolerance: {
      none: "mandatory",
      low: "mandatory",
      medium: "mandatory",
      high: "mandatory",
      critical: "mandatory",
    },
    spendLimits: { daily: 0, weekly: 0, monthly: 0, perAction: 0 },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
};

const STEP_LABELS = [
  "About your business",
  "Name your operator",
  "How much freedom?",
  "Connect your tools",
  "Meet your team",
];

const TOTAL_STEPS = 5;

export default function SetupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State
  const [businessName, setBusinessName] = useState("");
  const [selectedSkin, setSelectedSkin] = useState("generic");
  const [operatorName, setOperatorName] = useState("Ava");
  const [workingStyle, setWorkingStyle] = useState("friendly");
  const [governanceProfile, setGovernanceProfile] = useState("guarded");
  const [_connectionId, setConnectionId] = useState<string | null>(null);
  const [roster, setRoster] = useState<AgentRosterEntry[]>([]);

  if (status === "unauthenticated") redirect("/login");

  const organizationId = (session as unknown as { organizationId?: string })?.organizationId ?? "";
  const principalId = (session as unknown as { principalId?: string })?.principalId ?? "";

  const skin = SKIN_CATALOG.find((s) => s.id === selectedSkin);
  // Use first required cartridge for connection step
  const connectionCartridge = skin?.requiredCartridges?.[0] ?? "";

  const saveStep = async (stepIndex: number) => {
    try {
      if (stepIndex === 0 && businessName) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: businessName, skinId: selectedSkin }),
        });
      } else if (stepIndex === 2) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ governanceProfile }),
        });
      }
    } catch {
      // Silently continue
    }
  };

  const handleNext = async () => {
    await saveStep(step);

    // On moving to the welcome step, initialize the roster
    if (step === TOTAL_STEPS - 2) {
      try {
        const res = await fetch("/api/dashboard/agents/roster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operatorName: operatorName || "Ava",
            operatorConfig: {
              tone: workingStyle,
              workingStyle:
                workingStyle === "concise"
                  ? "Concise & Direct"
                  : workingStyle === "friendly"
                    ? "Friendly & Warm"
                    : "Professional & Detailed",
            },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setRoster(data.roster);
        }
      } catch {
        // Continue anyway
      }
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const canProceed = (() => {
    switch (step) {
      case 0:
        return businessName.trim().length > 0 && selectedSkin !== "";
      case 1:
        return operatorName.trim().length > 0 && workingStyle !== "";
      case 2:
        return governanceProfile !== "";
      case 3:
        return true; // Connection is optional
      case 4:
        return true;
      default:
        return false;
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
          skinId: selectedSkin,
          governanceProfile,
          runtimeType: "managed",
          onboardingComplete: true,
        }),
      });

      // 2. Create identity spec
      const preset = PROFILE_PRESETS[governanceProfile] ?? PROFILE_PRESETS.guarded;
      await fetch("/api/dashboard/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principalId,
          organizationId,
          name: businessName,
          description: `AI team for ${businessName}`,
          riskTolerance: preset.riskTolerance,
          globalSpendLimits: preset.spendLimits,
          cartridgeSpendLimits: {},
          forbiddenBehaviors: preset.forbiddenBehaviors,
          trustBehaviors: preset.trustBehaviors,
        }),
      });

      router.push("/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({
        title: "Setup failed",
        description: message,
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  return (
    <WizardShell
      step={step}
      stepLabels={STEP_LABELS}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed}
      isSubmitting={isSubmitting}
      isLastStep={step === TOTAL_STEPS - 1}
      onComplete={handleComplete}
    >
      {step === 0 && (
        <StepBusinessType
          businessName={businessName}
          onNameChange={setBusinessName}
          selectedSkin={selectedSkin}
          onSkinChange={setSelectedSkin}
        />
      )}
      {step === 1 && (
        <StepOperator
          operatorName={operatorName}
          onNameChange={setOperatorName}
          workingStyle={workingStyle}
          onStyleChange={setWorkingStyle}
        />
      )}
      {step === 2 && (
        <StepGovernanceSimple selected={governanceProfile} onChange={setGovernanceProfile} />
      )}
      {step === 3 && (
        <StepConnection cartridgeId={connectionCartridge} onConnectionCreated={setConnectionId} />
      )}
      {step === 4 && <StepWelcomeTeam operatorName={operatorName || "Ava"} roster={roster} />}
    </WizardShell>
  );
}
