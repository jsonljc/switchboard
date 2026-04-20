"use client";

import { useOrgConfig, useUpdateOrgConfig } from "./use-org-config";

interface FirstRunState {
  bannerDismissed: boolean;
  reviewedConversations: boolean;
  sentTestLead: boolean;
  visitedPlaybook: boolean;
}

const DEFAULT_STATE: FirstRunState = {
  bannerDismissed: false,
  reviewedConversations: false,
  sentTestLead: false,
  visitedPlaybook: false,
};

export function useFirstRun() {
  const { data: orgData } = useOrgConfig();
  const updateConfig = useUpdateOrgConfig();

  const firstRunPhase =
    (orgData?.config?.runtimeConfig?.firstRunPhase as FirstRunState | null) ?? DEFAULT_STATE;
  const isFirstRun = orgData?.config?.onboardingComplete === true && !firstRunPhase.bannerDismissed;

  const updateFirstRun = (updates: Partial<FirstRunState>) => {
    const merged = { ...firstRunPhase, ...updates };
    updateConfig.mutate({
      runtimeConfig: { ...orgData?.config?.runtimeConfig, firstRunPhase: merged },
    });
  };

  return {
    isFirstRun,
    state: firstRunPhase,
    dismissBanner: () => updateFirstRun({ bannerDismissed: true }),
    markReviewedConversations: () => updateFirstRun({ reviewedConversations: true }),
    markSentTestLead: () => updateFirstRun({ sentTestLead: true }),
    markVisitedPlaybook: () => updateFirstRun({ visitedPlaybook: true }),
  };
}
