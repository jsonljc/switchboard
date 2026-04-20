"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { useUpdateOrgConfig } from "@/hooks/use-org-config";
import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";
import { TrainingShell } from "@/components/onboarding/training-shell";
import { TestCenter } from "@/components/onboarding/test-center";
import { GoLive } from "@/components/onboarding/go-live";
import type { Playbook } from "@switchboard/schemas";

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: playbookData, isLoading } = usePlaybook();
  const updatePlaybook = useUpdatePlaybook();
  const updateOrgConfig = useUpdateOrgConfig();
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "loading" || isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: "var(--sw-base)" }}
      >
        <div className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!session || !playbookData) return null;

  const step = playbookData.step;
  const playbook = playbookData.playbook;

  const handleUpdatePlaybook = (updates: Partial<{ playbook: Playbook; step: number }>) => {
    updatePlaybook.mutate({
      playbook: updates.playbook ?? playbook,
      step: updates.step,
    });
  };

  switch (step) {
    case 1:
      return (
        <OnboardingEntry
          onScan={(url) => {
            setScanUrl(url);
            handleUpdatePlaybook({ step: 2 });
          }}
          onSkip={(cat) => {
            setCategory(cat);
            handleUpdatePlaybook({ step: 2 });
          }}
        />
      );
    case 2:
      return (
        <TrainingShell
          playbook={playbook}
          onUpdatePlaybook={(updated) => handleUpdatePlaybook({ playbook: updated })}
          onAdvance={() => handleUpdatePlaybook({ step: 3 })}
          scanUrl={scanUrl}
          category={category}
        />
      );
    case 3:
      return (
        <TestCenter
          prompts={[]}
          onSendPrompt={() => {}}
          onAdvance={() => handleUpdatePlaybook({ step: 4 })}
          responses={[]}
          isSimulating={false}
        />
      );
    case 4:
      return (
        <GoLive
          playbook={playbook}
          onLaunch={() => {
            updatePlaybook.mutate({ playbook, step: 4 });
            updateOrgConfig.mutate({ onboardingComplete: true });
          }}
          onBack={() => handleUpdatePlaybook({ step: 2 })}
          connectedChannels={[]}
          scenariosTested={0}
        />
      );
    default:
      return null;
  }
}
