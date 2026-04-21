"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { useUpdateOrgConfig } from "@/hooks/use-org-config";
import { generateTestPrompts } from "@/lib/prompt-generator";
import { useSimulation } from "@/hooks/use-simulation";
import type { TestPrompt } from "@/components/onboarding/prompt-card";
import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";
import { TrainingShell } from "@/components/onboarding/training-shell";
import { TestCenter } from "@/components/onboarding/test-center";
import { GoLive } from "@/components/onboarding/go-live";
import { createEmptyPlaybook, type Playbook } from "@switchboard/schemas";

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: playbookData, isLoading, isError } = usePlaybook();
  const updatePlaybook = useUpdatePlaybook();
  const updateOrgConfig = useUpdateOrgConfig();
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [localStep, setLocalStep] = useState(1);
  const [localPlaybook, setLocalPlaybook] = useState<Playbook>(() => createEmptyPlaybook());

  const simulation = useSimulation();
  const [responses, setResponses] = useState<
    Array<{
      promptId: string;
      userMessage: string;
      alexMessage: string;
      annotations: string[];
      status: "pending" | "good" | "fixed";
    }>
  >([]);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (playbookData) {
      setLocalStep(playbookData.step);
      setLocalPlaybook(playbookData.playbook);
    }
  }, [playbookData]);

  if (status === "loading" || (isLoading && !isError)) {
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

  if (!session) return null;

  const step = playbookData?.step ?? localStep;
  const playbook = playbookData?.playbook ?? localPlaybook;

  const handleUpdatePlaybook = (updates: Partial<{ playbook: Playbook; step: number }>) => {
    if (updates.step !== undefined) setLocalStep(updates.step);
    if (updates.playbook) setLocalPlaybook(updates.playbook);
    updatePlaybook.mutate({
      playbook: updates.playbook ?? playbook,
      step: updates.step,
    });
  };

  const testPrompts = generateTestPrompts(playbook);

  const handleSendPrompt = (prompt: TestPrompt) => {
    simulation.mutate(
      { playbook, userMessage: prompt.text },
      {
        onSuccess: (data) => {
          setResponses((prev) => [
            ...prev.filter((r) => r.promptId !== prompt.id),
            {
              promptId: prompt.id,
              userMessage: prompt.text,
              alexMessage: data.alexMessage,
              annotations: data.annotations,
              status: "pending",
            },
          ]);
        },
      },
    );
  };

  const handleRerunPrompt = (promptId: string) => {
    const prompt = testPrompts.find((p) => p.id === promptId);
    if (prompt) handleSendPrompt(prompt);
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
          prompts={testPrompts}
          onSendPrompt={handleSendPrompt}
          onRerunPrompt={handleRerunPrompt}
          onAdvance={() => handleUpdatePlaybook({ step: 4 })}
          responses={responses}
          isSimulating={simulation.isPending}
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
          scenariosTested={responses.length}
        />
      );
    default:
      return null;
  }
}
