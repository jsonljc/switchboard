"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { useManagedChannels, useProvision } from "@/hooks/use-managed-channels";
import { useOnboardingDraft } from "@/hooks/use-onboarding-draft";
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
  const channelsQuery = useManagedChannels();
  const provision = useProvision();
  const {
    draft,
    isHydrated: isOnboardingDraftHydrated,
    saveDraft,
    clearDraft,
  } = useOnboardingDraft(session?.organizationId);
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
  const [connectError, setConnectError] = useState<string>();

  const connectedChannels = (channelsQuery.data?.channels ?? []).map(
    (ch: { channel: string }) => ch.channel,
  );

  const handleConnectChannel = (channel: string, credentials: Record<string, string>) => {
    setConnectError(undefined);

    const provisionPayload: Record<string, unknown> = { channel };
    if (channel === "whatsapp") {
      provisionPayload.token = credentials.token;
      provisionPayload.phoneNumberId = credentials.phoneNumberId;
    } else if (channel === "telegram") {
      provisionPayload.botToken = credentials.botToken;
    }

    provision.mutate(
      {
        channels: [
          provisionPayload as {
            channel: string;
            botToken?: string;
            token?: string;
            phoneNumberId?: string;
          },
        ],
      },
      {
        onError: (err: Error) => {
          setConnectError(
            err.message || "Connection failed — check your credentials and try again",
          );
        },
      },
    );
  };

  const handleLaunch = async () => {
    setConnectError(undefined);
    try {
      const res = await fetch("/api/dashboard/agents/go-live/alex", { method: "PUT" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Launch failed");
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Launch failed");
      throw err;
    }
  };

  const handleLaunchComplete = () => {
    clearDraft();
    router.push("/");
  };

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (playbookData) {
      setLocalStep(playbookData.step);
      setLocalPlaybook(playbookData.playbook);
    }
  }, [playbookData]);

  useEffect(() => {
    setScanUrl(null);
    setCategory(null);
  }, [session?.organizationId]);

  const loadingScreen = (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ backgroundColor: "var(--sw-base)" }}
    >
      <div className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
        Loading...
      </div>
    </div>
  );

  if (status === "loading" || (isLoading && !isError)) {
    return loadingScreen;
  }

  if (!session) return null;

  const step = playbookData?.step ?? localStep;
  const playbook = playbookData?.playbook ?? localPlaybook;
  const restoredScanUrl = scanUrl ?? draft?.scanUrl ?? null;
  const restoredCategory = category ?? draft?.category ?? null;

  if (step === 2 && !isOnboardingDraftHydrated) {
    return loadingScreen;
  }

  const handleUpdatePlaybook = (updates: Partial<{ playbook: Playbook; step: number }>) => {
    if (updates.step !== undefined) setLocalStep(updates.step);
    if (updates.playbook) setLocalPlaybook(updates.playbook);
    updatePlaybook.mutate({
      playbook: updates.playbook ?? playbook,
      step: updates.step,
    });
  };

  const handleContinueManually = () => {
    const nextCategory = category ?? draft?.category ?? null;

    setScanUrl(null);
    saveDraft({ scanUrl: null, category: nextCategory });
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
            setCategory(null);
            saveDraft({ scanUrl: url, category: null });
            handleUpdatePlaybook({ step: 2 });
          }}
          onSkip={(cat) => {
            setScanUrl(null);
            setCategory(cat);
            saveDraft({ scanUrl: null, category: cat });
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
          onContinueManually={handleContinueManually}
          scanUrl={restoredScanUrl}
          category={restoredCategory}
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
          onLaunch={handleLaunch}
          onBack={() => handleUpdatePlaybook({ step: 2 })}
          connectedChannels={connectedChannels}
          scenariosTested={responses.length}
          onConnectChannel={handleConnectChannel}
          onLaunchComplete={handleLaunchComplete}
          isConnecting={provision.isPending}
          connectError={connectError}
        />
      );
    default:
      return null;
  }
}
