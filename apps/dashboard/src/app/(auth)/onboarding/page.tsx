"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { usePlaybook, useUpdatePlaybook } from "@/hooks/use-playbook";
import { OnboardingEntry } from "@/components/onboarding/onboarding-entry";
import type { Playbook } from "@switchboard/schemas";

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { data: playbookData, isLoading } = usePlaybook();
  const updatePlaybook = useUpdatePlaybook();
  const [_scanUrl, setScanUrl] = useState<string | null>(null);
  const [_category, setCategory] = useState<string | null>(null);

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
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ backgroundColor: "var(--sw-base)" }}
        >
          <p className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            Training — coming in Phase 2
          </p>
        </div>
      );
    case 3:
      return (
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ backgroundColor: "var(--sw-base)" }}
        >
          <p className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            Test Center — coming in Phase 4
          </p>
        </div>
      );
    case 4:
      return (
        <div
          className="flex min-h-screen items-center justify-center"
          style={{ backgroundColor: "var(--sw-base)" }}
        >
          <p className="text-[16px]" style={{ color: "var(--sw-text-muted)" }}>
            Go Live — coming in Phase 5
          </p>
        </div>
      );
    default:
      return null;
  }
}
