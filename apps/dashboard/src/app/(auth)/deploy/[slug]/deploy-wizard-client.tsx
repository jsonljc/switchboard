"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, useRef, useCallback, useMemo } from "react";
import {
  DeployWizardShell,
  type WizardStep,
  type WizardData,
} from "@/components/marketplace/deploy-wizard-shell";
import { ScanStep } from "@/components/marketplace/scan-step";
import { ReviewPersonaStep } from "@/components/marketplace/review-persona-step";
import { ConnectionStep } from "@/components/marketplace/connection-step";
import { TestChatStep } from "@/components/marketplace/test-chat-step";
import { WebsiteScanReview } from "@/components/marketplace/website-scan-review";
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";

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
        const res = await fetch("/api/dashboard/marketplace/onboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            listingId,
            businessName: data.persona?.businessName ?? "My Business",
            setupAnswers: data.persona ?? {},
            scannedProfile: data.scannedProfile ?? null,
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
