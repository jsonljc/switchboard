"use client";

import { useEffect, useState } from "react";
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";

export function useOnboardingDraft(organizationId?: string | null) {
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setDraft(null);
    setIsHydrated(false);

    if (!organizationId) {
      setIsHydrated(true);
      return;
    }

    setDraft(loadOnboardingDraft(organizationId));
    setIsHydrated(true);
  }, [organizationId]);

  const saveDraft = (nextDraft: OnboardingDraft) => {
    if (!organizationId) {
      return;
    }

    setDraft(nextDraft);
    saveOnboardingDraft(organizationId, nextDraft);
    setIsHydrated(true);
  };

  const clearDraft = () => {
    if (!organizationId) {
      return;
    }

    setDraft(null);
    clearOnboardingDraft(organizationId);
    setIsHydrated(true);
  };

  return { draft, isHydrated, saveDraft, clearDraft };
}
