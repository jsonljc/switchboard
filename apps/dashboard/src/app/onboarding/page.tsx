"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusinessBasics } from "@/components/onboarding/step-business-basics";
import { StepAgentSelection } from "@/components/onboarding/step-agent-selection";
import { StepAgentStyle } from "@/components/onboarding/step-agent-style";
import { StepKnowledgeRules } from "@/components/onboarding/step-knowledge-rules";
import { StepChannels } from "@/components/onboarding/step-channels";
import { StepReviewLaunch } from "@/components/onboarding/step-review-launch";
import { useToast } from "@/components/ui/use-toast";

const STEP_LABELS = [
  "Your business",
  "Build your team",
  "Set their style",
  "Teach them",
  "Connect channels",
  "Meet your team",
];

export interface BehavioralRule {
  id: string;
  type: "max-discount" | "always-escalate" | "never-discuss" | "custom";
  value: string;
}

export interface ChannelConfig {
  founderChannel: "telegram" | "whatsapp" | null;
  founderTelegramToken: string;
  founderWhatsAppToken: string;
  founderWhatsAppPhoneNumberId: string;
  customerWhatsAppToken: string;
  customerWhatsAppPhoneNumberId: string;
}

export default function OnboardingPage() {
  const { status } = useSession();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 0: Business basics
  const [vertical, setVertical] = useState("clinic");
  const [businessName, setBusinessName] = useState("");
  const [services, setServices] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  const [pricingRange, setPricingRange] = useState("");

  // Step 1: Agent selection
  const [selectedAgents, setSelectedAgents] = useState<string[]>([
    "lead-responder",
    "sales-closer",
  ]);

  // Step 2: Per-agent tone
  const [agentTones, setAgentTones] = useState<Record<string, string>>({});

  // Step 3: Knowledge + rules
  const [knowledgeText, setKnowledgeText] = useState("");
  const [rules, setRules] = useState<BehavioralRule[]>([]);

  // Step 4: Channels
  const [channels, setChannels] = useState<ChannelConfig>({
    founderChannel: null,
    founderTelegramToken: "",
    founderWhatsAppToken: "",
    founderWhatsAppPhoneNumberId: "",
    customerWhatsAppToken: "",
    customerWhatsAppPhoneNumberId: "",
  });

  // Step 5: Launch
  const [launchStatus, setLaunchStatus] = useState<"idle" | "launching" | "done">("idle");

  if (status === "loading") return null;
  if (status === "unauthenticated") redirect("/login");

  const canProceed = (() => {
    switch (step) {
      case 0:
        return businessName.trim() !== "" && services.trim() !== "";
      case 1:
        return selectedAgents.length > 0;
      case 2:
        return selectedAgents.every((id) => agentTones[id]);
      case 3:
        return true; // Knowledge and rules are optional
      case 4:
        return channels.founderChannel !== null;
      case 5:
        return true;
      default:
        return false;
    }
  })();

  const handleComplete = async () => {
    setIsSubmitting(true);
    setLaunchStatus("launching");
    try {
      const assertOk = async (res: Response, label: string) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(
            (data as Record<string, string>).error ?? `${label} failed (${res.status})`,
          );
        }
      };

      // 1. Persist business config + activate agents
      const wizardRes = await fetch("/api/dashboard/agents/wizard-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vertical,
          businessName,
          services: services
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          targetCustomer,
          pricingRange,
          purchasedAgents: selectedAgents,
          agentTones,
          tonePreset: agentTones[selectedAgents[0] ?? ""] ?? "warm-professional",
          language: "en",
        }),
      });
      await assertOk(wizardRes, "Agent setup");

      // 2. Upload knowledge (if provided)
      if (knowledgeText.trim()) {
        const knowledgeRes = await fetch("/api/dashboard/knowledge/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: knowledgeText,
            fileName: "onboarding-knowledge",
            agentId: "global",
            sourceType: "wizard",
          }),
        });
        await assertOk(knowledgeRes, "Knowledge upload");
      }

      // 3. Upload behavioral rules as knowledge chunks
      const ruleTexts = rules
        .filter((r) => r.value.trim())
        .map((r) => {
          switch (r.type) {
            case "max-discount":
              return `RULE: Never offer a discount greater than ${r.value}%. If a customer asks for a larger discount, politely decline and offer the maximum of ${r.value}% instead.`;
            case "always-escalate":
              return `RULE: Always escalate to the business owner when: ${r.value}. Do not attempt to handle this yourself.`;
            case "never-discuss":
              return `RULE: Never discuss or provide information about: ${r.value}. If asked, politely redirect the conversation.`;
            case "custom":
              return `RULE: ${r.value}`;
          }
        });

      if (ruleTexts.length > 0) {
        const rulesRes = await fetch("/api/dashboard/knowledge/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: ruleTexts.join("\n\n"),
            fileName: "behavioral-rules",
            agentId: "global",
            sourceType: "wizard",
          }),
        });
        await assertOk(rulesRes, "Rules upload");
      }

      // 4. Provision channels
      const channelsToProvision: Array<Record<string, string | undefined>> = [];

      if (channels.founderChannel === "telegram" && channels.founderTelegramToken) {
        channelsToProvision.push({
          channel: "telegram",
          botToken: channels.founderTelegramToken,
        });
      }

      if (channels.founderChannel === "whatsapp" && channels.founderWhatsAppToken) {
        channelsToProvision.push({
          channel: "whatsapp",
          token: channels.founderWhatsAppToken,
          phoneNumberId: channels.founderWhatsAppPhoneNumberId,
        });
      }

      // Customer WhatsApp (separate from founder channel)
      if (channels.customerWhatsAppToken && channels.customerWhatsAppPhoneNumberId) {
        // Only add if not already covered by founder WhatsApp
        if (channels.founderChannel !== "whatsapp") {
          channelsToProvision.push({
            channel: "whatsapp",
            token: channels.customerWhatsAppToken,
            phoneNumberId: channels.customerWhatsAppPhoneNumberId,
          });
        }
      }

      if (channelsToProvision.length > 0) {
        const provisionRes = await fetch("/api/dashboard/organizations/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels: channelsToProvision }),
        });
        await assertOk(provisionRes, "Channel provisioning");
      }

      setLaunchStatus("done");
      toast({
        title: "Your team is ready!",
        description: "Redirecting to your dashboard...",
      });

      setTimeout(() => router.push("/"), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Setup failed", description: message, variant: "destructive" });
      setLaunchStatus("idle");
    } finally {
      setIsSubmitting(false);
      setChannels((prev) => ({
        ...prev,
        founderTelegramToken: "",
        founderWhatsAppToken: "",
        customerWhatsAppToken: "",
      }));
    }
  };

  return (
    <WizardShell
      step={step}
      stepLabels={STEP_LABELS}
      onNext={() => setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1))}
      onBack={() => setStep((s) => Math.max(s - 1, 0))}
      canProceed={canProceed}
      isSubmitting={isSubmitting}
      isLastStep={step === STEP_LABELS.length - 1}
      onComplete={handleComplete}
    >
      {step === 0 && (
        <StepBusinessBasics
          vertical={vertical}
          onVerticalChange={setVertical}
          businessName={businessName}
          onNameChange={setBusinessName}
          services={services}
          onServicesChange={setServices}
          targetCustomer={targetCustomer}
          onTargetCustomerChange={setTargetCustomer}
          pricingRange={pricingRange}
          onPricingRangeChange={setPricingRange}
        />
      )}
      {step === 1 && (
        <StepAgentSelection selected={selectedAgents} onSelectionChange={setSelectedAgents} />
      )}
      {step === 2 && (
        <StepAgentStyle
          selectedAgents={selectedAgents}
          agentTones={agentTones}
          onTonesChange={setAgentTones}
          businessName={businessName}
        />
      )}
      {step === 3 && (
        <StepKnowledgeRules
          knowledgeText={knowledgeText}
          onKnowledgeChange={setKnowledgeText}
          rules={rules}
          onRulesChange={setRules}
        />
      )}
      {step === 4 && <StepChannels channels={channels} onChannelsChange={setChannels} />}
      {step === 5 && (
        <StepReviewLaunch
          businessName={businessName}
          selectedAgents={selectedAgents}
          agentTones={agentTones}
          channels={channels}
          launchStatus={launchStatus}
        />
      )}
    </WizardShell>
  );
}
