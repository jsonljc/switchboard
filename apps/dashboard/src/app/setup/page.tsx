"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusinessType } from "@/components/onboarding/step-business-type";
import { StepConnection } from "@/components/onboarding/step-connection";
import { StepBudget } from "@/components/onboarding/step-budget";
import { StepTelegram } from "@/components/onboarding/step-telegram";
import { StepAllSet } from "@/components/onboarding/step-all-set";
import { SKIN_CATALOG } from "@/lib/skin-catalog";

// New business → guarded governance profile (all campaign changes require approval)
const GUARDED_PRESET = {
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
};

const STEP_LABELS = [
  "About your business",
  "Connect Meta Ads",
  "Set your budget",
  "Connect Telegram",
  "You're all set!",
];

const TOTAL_STEPS = 5;

export default function SetupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 0: Business info
  const [businessName, setBusinessName] = useState("");
  const [selectedSkin, setSelectedSkin] = useState("generic");

  // Step 1: Meta Ads connection
  const [_connectionId, setConnectionId] = useState<string | null>(null);

  // Step 2: Budget
  const [monthlyBudget, setMonthlyBudget] = useState(500);

  // Step 3: Telegram
  const [ownerBotConnected, setOwnerBotConnected] = useState(false);
  const [leadBotToken, setLeadBotToken] = useState("");
  const [skipLeadBot, setSkipLeadBot] = useState(false);

  // Step 4: Completion
  const [isHandoffTriggered, setIsHandoffTriggered] = useState(false);
  const [isHandoffLoading, setIsHandoffLoading] = useState(false);

  if (status === "unauthenticated") redirect("/login");

  const organizationId = (session as unknown as { organizationId?: string })?.organizationId ?? "";
  const principalId = (session as unknown as { principalId?: string })?.principalId ?? "";

  const skin = SKIN_CATALOG.find((s) => s.id === selectedSkin);
  // Use digital-ads cartridge for Meta Ads connection
  const connectionCartridge = skin?.requiredCartridges?.includes("digital-ads")
    ? "digital-ads"
    : (skin?.requiredCartridges?.[0] ?? "digital-ads");

  const saveStep = async (stepIndex: number) => {
    try {
      if (stepIndex === 0 && businessName) {
        await fetch("/api/dashboard/organizations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: businessName, skinId: selectedSkin }),
        });
      }
    } catch {
      // Silently continue
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
      case 0:
        return businessName.trim().length > 0 && selectedSkin !== "";
      case 1:
        return true; // Meta Ads connection is optional at onboarding
      case 2:
        return monthlyBudget >= 200;
      case 3:
        return true; // Telegram is optional (can connect later)
      case 4:
        return true;
      default:
        return false;
    }
  })();

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Derive spend limits from monthly budget
      const dailyBudget = Math.round((monthlyBudget / 30) * 100) / 100;
      const weeklyBudget = Math.round(dailyBudget * 7 * 100) / 100;

      // 1. Finalize org config
      await fetch("/api/dashboard/organizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName,
          skinId: selectedSkin,
          governanceProfile: "guarded",
          runtimeType: "managed",
          onboardingComplete: true,
        }),
      });

      // 2. Create identity spec with budget-derived spend limits
      const preset = {
        ...GUARDED_PRESET,
        spendLimits: {
          daily: dailyBudget,
          weekly: weeklyBudget,
          monthly: monthlyBudget,
          perAction: Math.round(dailyBudget * 0.5 * 100) / 100,
        },
      };

      await fetch("/api/dashboard/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principalId,
          organizationId,
          name: businessName,
          description: `AI marketing operator for ${businessName}`,
          riskTolerance: preset.riskTolerance,
          globalSpendLimits: preset.spendLimits,
          cartridgeSpendLimits: {},
          forbiddenBehaviors: preset.forbiddenBehaviors,
          trustBehaviors: preset.trustBehaviors,
        }),
      });

      // 3. Provision Telegram channels if configured
      if (ownerBotConnected || leadBotToken) {
        const channels: string[] = [];
        const channelCredentials: Record<string, Record<string, string>> = {};

        if (ownerBotConnected) {
          channels.push("telegram");
        }

        if (leadBotToken) {
          channelCredentials["telegram-lead"] = { botToken: leadBotToken };
        }

        if (channels.length > 0) {
          await fetch("/api/dashboard/organizations/provision", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channels, channelCredentials }),
          });
        }
      }

      // 4. Initialize agent roster
      try {
        await fetch("/api/dashboard/agents/roster", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operatorName: "Ava",
            operatorConfig: {
              tone: "friendly",
              workingStyle: "Friendly & Warm",
            },
          }),
        });
      } catch {
        // Non-critical
      }

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

  const handleTriggerHandoff = async () => {
    setIsHandoffLoading(true);
    try {
      await fetch("/api/dashboard/organizations/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      setIsHandoffTriggered(true);
    } catch {
      toast({
        title: "Handoff failed",
        description: "Could not start campaign analysis. You can try again from Settings.",
        variant: "destructive",
      });
    } finally {
      setIsHandoffLoading(false);
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
        <StepConnection cartridgeId={connectionCartridge} onConnectionCreated={setConnectionId} />
      )}
      {step === 2 && <StepBudget monthlyBudget={monthlyBudget} onBudgetChange={setMonthlyBudget} />}
      {step === 3 && (
        <StepTelegram
          organizationId={organizationId}
          ownerBotConnected={ownerBotConnected}
          onOwnerBotConnected={() => setOwnerBotConnected(true)}
          leadBotToken={leadBotToken}
          onLeadBotTokenChange={setLeadBotToken}
          skipLeadBot={skipLeadBot}
          onSkipLeadBot={setSkipLeadBot}
        />
      )}
      {step === 4 && (
        <StepAllSet
          businessName={businessName}
          organizationId={organizationId}
          isHandoffTriggered={isHandoffTriggered}
          isHandoffLoading={isHandoffLoading}
          onTriggerHandoff={handleTriggerHandoff}
        />
      )}
    </WizardShell>
  );
}
