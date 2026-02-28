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
import { StepManagedChannels } from "@/components/onboarding/step-managed-channels";
import { StepComplete } from "@/components/onboarding/step-complete";

// Governance profile presets (mirrors @switchboard/core governance-presets.ts)
const PROFILE_PRESETS: Record<string, {
  riskTolerance: Record<string, string>;
  spendLimits: Record<string, number | null>;
  forbiddenBehaviors: string[];
  trustBehaviors: string[];
}> = {
  observe: {
    riskTolerance: { none: "none", low: "none", medium: "none", high: "none", critical: "none" },
    spendLimits: { daily: null, weekly: null, monthly: null, perAction: null },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  guarded: {
    riskTolerance: { none: "none", low: "none", medium: "standard", high: "elevated", critical: "mandatory" },
    spendLimits: { daily: 10000, weekly: null, monthly: null, perAction: 5000 },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  strict: {
    riskTolerance: { none: "none", low: "standard", medium: "elevated", high: "mandatory", critical: "mandatory" },
    spendLimits: { daily: 5000, weekly: 20000, monthly: 50000, perAction: 1000 },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
  locked: {
    riskTolerance: { none: "mandatory", low: "mandatory", medium: "mandatory", high: "mandatory", critical: "mandatory" },
    spendLimits: { daily: 0, weekly: 0, monthly: 0, perAction: 0 },
    forbiddenBehaviors: [],
    trustBehaviors: [],
  },
};

const STEP_LABELS_DEFAULT = [
  "About your business",
  "How does your AI connect?",
  "How much oversight?",
  "Choose your first domain",
  "Connect your service",
  "You're ready",
];

const STEP_LABELS_MANAGED = [
  "About your business",
  "How does your AI connect?",
  "How much oversight?",
  "Choose your first domain",
  "Set up your channels",
  "You're ready",
];

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

  // Managed channel state
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [channelCredentials, setChannelCredentials] = useState<Record<string, Record<string, string>>>({});
  const [provisionResult, setProvisionResult] = useState<{
    channels: Array<{ channel: string; botUsername?: string; webhookUrl?: string; status: string; note?: string }>;
  } | null>(null);

  if (status === "unauthenticated") redirect("/login");

  const organizationId = (session as any)?.organizationId ?? "";
  const principalId = (session as any)?.principalId ?? "";
  const isManaged = runtimeType === "managed";
  const stepLabels = isManaged ? STEP_LABELS_MANAGED : STEP_LABELS_DEFAULT;

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
      } else if (stepIndex === 3 && cartridgeId) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedCartridgeId: cartridgeId }),
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

  const handleCredentialsChange = (channel: string, creds: Record<string, string>) => {
    setChannelCredentials((prev) => ({ ...prev, [channel]: creds }));
  };

  // Check if managed channels step has valid input
  const isManagedChannelsValid = () => {
    if (selectedChannels.length === 0) return false;
    for (const ch of selectedChannels) {
      const creds = channelCredentials[ch];
      if (!creds?.botToken) return false;
      if (ch === "slack" && !creds?.signingSecret) return false;
    }
    return true;
  };

  const canProceed = (() => {
    switch (step) {
      case 0: return businessName.trim().length > 0;
      case 1: return runtimeType !== "";
      case 2: return governanceProfile !== "";
      case 3: return cartridgeId !== "";
      case 4: return isManaged ? isManagedChannelsValid() : true;
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
            forbiddenBehaviors: preset.forbiddenBehaviors,
            trustBehaviors: preset.trustBehaviors,
          }),
        });
      }

      // 3. If managed, provision channels
      if (isManaged && selectedChannels.length > 0) {
        const channels = selectedChannels.map((ch) => ({
          channel: ch as "telegram" | "slack",
          botToken: channelCredentials[ch]?.botToken ?? "",
          webhookSecret: channelCredentials[ch]?.webhookSecret,
          signingSecret: channelCredentials[ch]?.signingSecret,
        }));

        const provisionRes = await fetch("/api/dashboard/organizations/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels }),
        });

        if (!provisionRes.ok) {
          const data = await provisionRes.json().catch(() => ({}));
          throw new Error(data.error || "Provisioning failed");
        }

        const result = await provisionRes.json();
        setProvisionResult(result);
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
      stepLabels={stepLabels}
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
        isManaged ? (
          <StepManagedChannels
            selectedChannels={selectedChannels}
            onChannelsChange={setSelectedChannels}
            channelCredentials={channelCredentials}
            onCredentialsChange={handleCredentialsChange}
          />
        ) : (
          <StepConnection
            cartridgeId={cartridgeId}
            onConnectionCreated={setConnectionId}
          />
        )
      )}
      {step === 5 && (
        <StepComplete
          businessName={businessName}
          runtimeType={runtimeType}
          governanceProfile={governanceProfile}
          cartridgeId={cartridgeId}
          organizationId={organizationId}
          provisionResult={provisionResult}
        />
      )}
    </WizardShell>
  );
}
