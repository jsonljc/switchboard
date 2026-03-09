"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusinessType } from "@/components/onboarding/step-business-type";
import { StepOperator } from "@/components/onboarding/step-operator";
import { StepCapabilities } from "@/components/onboarding/step-capabilities";
import { StepGovernanceSimple } from "@/components/onboarding/step-governance-simple";
import { StepConnection } from "@/components/onboarding/step-connection";
import { StepBudget } from "@/components/onboarding/step-budget";
import { StepTelegram } from "@/components/onboarding/step-telegram";
import { StepAllSet } from "@/components/onboarding/step-all-set";
import { SKIN_CATALOG } from "@/lib/skin-catalog";
import { useInitializeRoster } from "@/hooks/use-agents";

const STEP_LABELS = [
  "About your business",
  "Name your operator",
  "Choose capabilities",
  "How much freedom?",
  "Connect your ads",
  "Set your budget",
  "Connect Telegram",
  "You're all set!",
];

const TOTAL_STEPS = STEP_LABELS.length;

/** Map simple governance choice to AdsOperatorConfig automationLevel */
function governanceToAutomationLevel(mode: string): "copilot" | "supervised" | "autonomous" {
  switch (mode) {
    case "observe":
      return "autonomous";
    case "guarded":
      return "supervised";
    case "strict":
    case "locked":
    default:
      return "copilot";
  }
}

export default function SetupPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const initializeRoster = useInitializeRoster();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 0: Business info
  const [businessName, setBusinessName] = useState("");
  const [selectedSkin, setSelectedSkin] = useState("generic");

  // Step 1: Operator
  const [operatorName, setOperatorName] = useState("Ava");
  const [workingStyle, setWorkingStyle] = useState("friendly");

  // Step 2: Capabilities
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [capabilitiesInitialized, setCapabilitiesInitialized] = useState(false);

  // Step 3: Governance
  const [governanceMode, setGovernanceMode] = useState("guarded");

  // Step 4: Connection
  const [_connectionId, setConnectionId] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  // Step 5: Budget
  const [monthlyBudget, setMonthlyBudget] = useState(1000);

  // Step 6: Telegram
  const [ownerBotConnected, setOwnerBotConnected] = useState(false);
  const [leadBotToken, setLeadBotToken] = useState("");
  const [skipLeadBot, setSkipLeadBot] = useState(false);

  // Step 7: All Set
  const [isHandoffTriggered, setIsHandoffTriggered] = useState(false);
  const [isHandoffLoading, setIsHandoffLoading] = useState(false);

  if (status === "unauthenticated") redirect("/login");

  const organizationId = (session as unknown as { organizationId?: string })?.organizationId ?? "";
  const principalId = (session as unknown as { principalId?: string })?.principalId ?? "";

  const skin = SKIN_CATALOG.find((s) => s.id === selectedSkin);
  const requiredCartridges = skin?.requiredCartridges ?? [];

  // Use digital-ads cartridge for connection step
  const connectionCartridge = requiredCartridges.includes("digital-ads")
    ? "digital-ads"
    : (requiredCartridges[0] ?? "digital-ads");

  const canProceed = (() => {
    switch (step) {
      case 0:
        return businessName.trim().length > 0 && selectedSkin !== "";
      case 1:
        return operatorName.trim().length > 0 && workingStyle !== "";
      case 2:
        return selectedCapabilities.length > 0;
      case 3:
        return governanceMode !== "";
      case 4:
        return true; // Connection is optional
      case 5:
        return monthlyBudget >= 200;
      case 6:
        return true; // Telegram is optional (can connect later)
      case 7:
        return true;
      default:
        return false;
    }
  })();

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
      // Silently continue — will be saved on complete
    }
  };

  const handleNext = async () => {
    await saveStep(step);

    // Initialize capabilities defaults when moving from step 0
    if (step === 0 && !capabilitiesInitialized) {
      const allCaps = getAllCapabilityIds(requiredCartridges);
      setSelectedCapabilities(allCaps);
      setCapabilitiesInitialized(true);
    }

    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };

  const handleBack = () => {
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleTriggerHandoff = async () => {
    setIsHandoffLoading(true);
    try {
      const res = await fetch("/api/dashboard/organizations/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Handoff failed");
      }
      setIsHandoffTriggered(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start analysis";
      toast({ title: "Handoff failed", description: message, variant: "destructive" });
    } finally {
      setIsHandoffLoading(false);
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // 1. Save skinId and governance to OrganizationConfig
      await fetch("/api/dashboard/organizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName,
          skinId: selectedSkin,
          governanceProfile: governanceMode,
          runtimeType: "managed",
          onboardingComplete: true,
        }),
      });

      // 2. Create identity spec
      const dailyBudgetCap = Math.round((monthlyBudget / 30) * 100) / 100;
      await fetch("/api/dashboard/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principalId,
          organizationId,
          name: businessName,
          description: `AI marketing operator for ${businessName}`,
          riskTolerance: {
            none: "none",
            low: "none",
            medium: "standard",
            high: "elevated",
            critical: "mandatory",
          },
          globalSpendLimits: {
            daily: dailyBudgetCap,
            weekly: null,
            monthly: monthlyBudget,
            perAction: Math.round(monthlyBudget / 10),
          },
          cartridgeSpendLimits: {},
          forbiddenBehaviors: [],
          trustBehaviors: [],
        }),
      });

      // 3. Initialize agent roster
      try {
        await initializeRoster.mutateAsync({
          operatorName: operatorName.trim() || "Ava",
          operatorConfig: {
            tone: workingStyle,
            workingStyle:
              workingStyle === "concise"
                ? "Concise & Direct"
                : workingStyle === "friendly"
                  ? "Friendly & Warm"
                  : "Professional & Detailed",
          },
        });
      } catch {
        // May already be initialized — that's fine
      }

      // 4. Create AdsOperatorConfig — activates the agent runner
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
      const automationLevel = governanceToAutomationLevel(governanceMode);

      const platformMap: Record<string, string> = {
        "meta-ads": "meta",
        "google-ads": "google",
        "tiktok-ads": "tiktok",
      };
      const platform = platformMap[selectedPlatform ?? "meta-ads"] ?? "meta";

      await fetch("/api/dashboard/operator-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountIds: ["default"],
          platforms: [platform],
          automationLevel,
          targets: {
            dailyBudgetCap,
          },
          schedule: {
            optimizerCronHour: 6,
            reportCronHour: 8,
            timezone,
          },
          notificationChannel: {
            type: "telegram",
            chatId: organizationId,
          },
          active: true,
        }),
      });

      // 5. Redirect to mission control
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
          onSkinChange={(skinId) => {
            setSelectedSkin(skinId);
            setCapabilitiesInitialized(false);
          }}
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
        <StepCapabilities
          requiredCartridges={requiredCartridges}
          selectedCapabilities={selectedCapabilities}
          onCapabilitiesChange={setSelectedCapabilities}
        />
      )}
      {step === 3 && (
        <StepGovernanceSimple selected={governanceMode} onChange={setGovernanceMode} />
      )}
      {step === 4 && (
        <StepConnection
          cartridgeId={connectionCartridge}
          onConnectionCreated={setConnectionId}
          onPlatformSelected={setSelectedPlatform}
        />
      )}
      {step === 5 && <StepBudget monthlyBudget={monthlyBudget} onBudgetChange={setMonthlyBudget} />}
      {step === 6 && (
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
      {step === 7 && (
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

/** Get all capability IDs for a set of cartridges */
function getAllCapabilityIds(cartridgeIds: string[]): string[] {
  const CARTRIDGE_CAPABILITIES: Record<string, string[]> = {
    "digital-ads": ["campaign-management", "budget-optimization", "performance-monitoring"],
    "customer-engagement": ["lead-response", "lead-qualification", "follow-up"],
    crm: ["contact-management", "deal-tracking"],
    payments: ["payment-processing", "invoice-management"],
  };
  const ids: string[] = [];
  for (const cartridgeId of cartridgeIds) {
    const caps = CARTRIDGE_CAPABILITIES[cartridgeId];
    if (caps) ids.push(...caps);
  }
  return ids;
}
