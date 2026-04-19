"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useRef, useCallback, useMemo } from "react";
import {
  DeployWizardShell,
  type WizardStep,
  type WizardData,
  type WizardStepProps,
} from "@/components/marketplace/deploy-wizard-shell";
import { ScanStep } from "@/components/marketplace/scan-step";
import { ReviewPersonaStep } from "@/components/marketplace/review-persona-step";
import { ConnectionStep } from "@/components/marketplace/connection-step";
import { TestChatStep } from "@/components/marketplace/test-chat-step";
import { WebsiteScanReview } from "@/components/marketplace/website-scan-review";
import { BusinessFactsForm } from "@/components/marketplace/business-facts-form";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";
import { BusinessFactsSchema } from "@switchboard/schemas";
import type { BusinessFacts } from "@switchboard/schemas";

interface ConnectionRequirement {
  type: string;
  reason: string;
}

interface OnboardingConfig {
  websiteScan?: boolean;
  publicChannels?: boolean;
  privateChannel?: boolean;
  integrations?: string[];
}

interface SetupSchema {
  onboarding?: OnboardingConfig;
  steps?: unknown[];
}

interface DeployWizardClientProps {
  listingId: string;
  listingSlug: string;
  agentName: string;
  roleFocus: RoleFocus;
  connections: ConnectionRequirement[];
  setupSchema?: SetupSchema | null;
}

function BusinessFactsStep({ data, onUpdate, onNext }: WizardStepProps) {
  const [_isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(
    (facts: BusinessFacts) => {
      const result = BusinessFactsSchema.safeParse(facts);
      if (!result.success) return;
      setIsSaving(true);
      onUpdate({ businessFacts: result.data });
      setIsSaving(false);
      onNext();
    },
    [onUpdate, onNext],
  );

  const prefilled = data.scannedProfile ? prefillFromScan(data.scannedProfile) : undefined;

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Business Facts</h3>
      <p className="text-sm text-muted-foreground mb-6">
        These facts determine what Alex can answer. Missing facts will trigger escalation to your
        team.
      </p>
      <BusinessFactsForm initialFacts={data.businessFacts ?? prefilled} onSave={handleSave} />
    </div>
  );
}

function prefillFromScan(scanned: Record<string, unknown>): Partial<BusinessFacts> {
  const result: Partial<BusinessFacts> = {};
  if (typeof scanned["businessName"] === "string") {
    result.businessName = scanned["businessName"];
  }
  if (Array.isArray(scanned["products"])) {
    result.services = (
      scanned["products"] as Array<{ name: string; description: string; price?: string }>
    ).map((p) => ({ name: p.name, description: p.description, price: p.price, currency: "SGD" }));
  }
  if (scanned["location"] && typeof scanned["location"] === "object") {
    const loc = scanned["location"] as { address?: string; city?: string };
    result.locations = [
      { name: "Main", address: [loc.address, loc.city].filter(Boolean).join(", ") },
    ];
  }
  if (scanned["hours"] && typeof scanned["hours"] === "object") {
    const hours = scanned["hours"] as Record<string, string>;
    result.openingHours = Object.fromEntries(
      Object.entries(hours).map(([day, val]) => {
        const match = val.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        return [
          day,
          match
            ? { open: match[1]!, close: match[2]!, closed: false }
            : { open: "09:00", close: "18:00", closed: false },
        ];
      }),
    );
  }
  if (Array.isArray(scanned["faqs"])) {
    result.additionalFaqs = scanned["faqs"] as Array<{ question: string; answer: string }>;
  }
  return result;
}

export function DeployWizardClient({
  listingId,
  listingSlug,
  agentName,
  roleFocus,
  connections,
  setupSchema,
}: DeployWizardClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeploying, startDeploy] = useTransition();

  const wizardDataRef = useRef<WizardData>({
    listingId,
    listingSlug,
    connections: {},
  });

  const handleDataChange = useCallback((data: WizardData) => {
    wizardDataRef.current = data;
  }, []);

  const onboarding: OnboardingConfig = setupSchema?.onboarding ?? {
    websiteScan: true,
    publicChannels: true,
    privateChannel: false,
    integrations: [],
  };

  const handleDeploy = useCallback(() => {
    setError(null);
    startDeploy(async () => {
      try {
        const data = wizardDataRef.current;
        if (!data.businessFacts) {
          setError("Business facts are required before deploying.");
          return;
        }
        const res = await fetch("/api/dashboard/marketplace/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listingId,
            businessName:
              data.persona?.businessName ?? data.businessFacts?.businessName ?? "My Business",
            setupAnswers: data.persona ?? {},
            scannedProfile: data.scannedProfile ?? null,
            businessFacts: data.businessFacts,
          }),
        });
        if (!res.ok) {
          const err = await res.json();
          console.error("Onboard failed:", err);
          setError("Deploy failed");
          return;
        }
        const result = await res.json();
        router.push(result.dashboardUrl || `/deployments/${result.deploymentId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deploy failed");
      }
    });
  }, [listingId, router]);

  const steps: WizardStep[] = useMemo(() => {
    const allSteps: WizardStep[] = [];

    if (onboarding.websiteScan !== false) {
      allSteps.push({ id: "scan", label: "Learn your business", component: ScanStep });
      allSteps.push({
        id: "review-scan",
        label: "Review profile",
        component: WebsiteScanReview as unknown as WizardStep["component"],
      });
    }

    allSteps.push({
      id: "business-facts",
      label: "Business facts",
      component: BusinessFactsStep as unknown as WizardStep["component"],
    });

    allSteps.push({ id: "review", label: "Review & customize", component: ReviewPersonaStep });

    for (const conn of connections) {
      allSteps.push({
        id: `connect-${conn.type}`,
        label: `Connect ${conn.type}`,
        component: ConnectionStep as unknown as WizardStep["component"],
        props: { connectionType: conn.type, reason: conn.reason },
      });
    }

    allSteps.push({
      id: "test-chat",
      label: "Test your agent",
      component: TestChatStep as unknown as WizardStep["component"],
      props: { onDeploy: handleDeploy, isDeploying },
    });

    return allSteps;
  }, [connections, handleDeploy, isDeploying, onboarding.websiteScan]);

  const header = (
    <div className="flex items-center gap-4 mb-8">
      <div className="w-16 h-16 shrink-0">
        <OperatorCharacter roleFocus={roleFocus} className="w-full h-full" />
      </div>
      <div>
        <h2 className="font-display text-xl text-foreground">
          Let&apos;s get {agentName} up to speed.
        </h2>
      </div>
    </div>
  );

  return (
    <>
      <DeployWizardShell
        steps={steps}
        initialData={{ listingId, listingSlug }}
        header={header}
        onDataChange={handleDataChange}
      />
      {error && <p className="text-sm text-destructive mt-4 text-center">{error}</p>}
    </>
  );
}
