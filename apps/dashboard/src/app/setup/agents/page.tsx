"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { redirect, useRouter } from "next/navigation";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepBusinessBasics } from "@/components/onboarding/step-business-basics";
import { StepBookingPlatform } from "@/components/onboarding/step-booking-platform";
import { StepAgentSelection } from "@/components/onboarding/step-agent-selection";
import { StepToneLanguage } from "@/components/onboarding/step-tone-language";
import { useToast } from "@/components/ui/use-toast";

const STEP_LABELS = ["Business basics", "Booking platform", "Select agents", "Tone & language"];

export default function SetupAgentsPage() {
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

  // Step 1: Booking platform
  const [platform, setPlatform] = useState("calendly");
  const [bookingUrl, setBookingUrl] = useState("");

  // Step 2: Agent selection
  const [selectedAgents, setSelectedAgents] = useState(["lead-responder", "sales-closer"]);

  // Step 3: Tone & language
  const [tone, setTone] = useState("warm-professional");
  const [language, setLanguage] = useState("en");

  if (status === "loading") {
    return null;
  }

  if (status === "unauthenticated") {
    redirect("/login");
  }

  const canProceed = () => {
    switch (step) {
      case 0:
        return businessName.trim() !== "" && services.trim() !== "";
      case 1:
        return bookingUrl.trim() !== "";
      case 2:
        return selectedAgents.length > 0;
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step < STEP_LABELS.length - 1) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/dashboard/agents/wizard-complete", {
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
          bookingPlatform: platform,
          bookingUrl,
          purchasedAgents: selectedAgents,
          tonePreset: tone,
          language,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to complete setup");
      }

      toast({
        title: "Setup complete",
        description: "Your agents are being configured. Redirecting...",
      });

      router.push("/knowledge");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Setup failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <WizardShell
      step={step}
      stepLabels={STEP_LABELS}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed()}
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
        <StepBookingPlatform
          platform={platform}
          onPlatformChange={setPlatform}
          bookingUrl={bookingUrl}
          onUrlChange={setBookingUrl}
        />
      )}
      {step === 2 && (
        <StepAgentSelection selected={selectedAgents} onSelectionChange={setSelectedAgents} />
      )}
      {step === 3 && (
        <StepToneLanguage
          tone={tone}
          onToneChange={setTone}
          language={language}
          onLanguageChange={setLanguage}
        />
      )}
    </WizardShell>
  );
}
