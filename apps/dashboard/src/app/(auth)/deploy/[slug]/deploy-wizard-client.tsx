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
import { OperatorCharacter } from "@/components/character/operator-character";
import type { RoleFocus } from "@/components/character/operator-character";

interface ConnectionRequirement {
  type: string;
  reason: string;
}

interface DeployWizardClientProps {
  listingId: string;
  listingSlug: string;
  agentName: string;
  roleFocus: RoleFocus;
  connections: ConnectionRequirement[];
}

export function DeployWizardClient({
  listingId,
  listingSlug,
  agentName,
  roleFocus,
  connections,
}: DeployWizardClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [_isDeploying, startDeploy] = useTransition();

  const wizardDataRef = useRef<WizardData>({
    listingId,
    listingSlug,
    connections: {},
  });

  const handleDataChange = useCallback((data: WizardData) => {
    wizardDataRef.current = data;
  }, []);

  const handleDeploy = useCallback(() => {
    setError(null);
    startDeploy(async () => {
      try {
        const data = wizardDataRef.current;
        const res = await fetch(`/api/dashboard/marketplace/listings/${listingId}/deploy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            persona: data.persona,
            governanceSettings: { startingAutonomy: "supervised" },
          }),
        });

        if (!res.ok) throw new Error("Deploy failed");
        router.push("/dashboard");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Deploy failed");
      }
    });
  }, [listingId, router]);

  const steps: WizardStep[] = useMemo(
    () => [
      { id: "scan", label: "Learn your business", component: ScanStep },
      { id: "review", label: "Review & customize", component: ReviewPersonaStep },
      ...connections.map((conn) => ({
        id: `connect-${conn.type}`,
        label: `Connect ${conn.type}`,
        component: ConnectionStep as unknown as WizardStep["component"],
        props: { connectionType: conn.type, reason: conn.reason },
      })),
      {
        id: "test-chat",
        label: "Test your agent",
        component: TestChatStep as unknown as WizardStep["component"],
        props: { onDeploy: handleDeploy },
      },
    ],
    [connections, handleDeploy],
  );

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
      {error && <p className="text-sm text-negative">{error}</p>}
    </div>
  );

  return (
    <DeployWizardShell
      steps={steps}
      initialData={{ listingId, listingSlug }}
      header={header}
      onDataChange={handleDataChange}
    />
  );
}
