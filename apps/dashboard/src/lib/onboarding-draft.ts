export interface OnboardingDraft {
  scanUrl: string | null;
  category: string | null;
}

const STORAGE_PREFIX = "sw-onboarding-draft:";

function getStorageKey(organizationId: string) {
  return `${STORAGE_PREFIX}${organizationId}`;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isOnboardingDraft(value: unknown): value is OnboardingDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const draft = value as Record<string, unknown>;

  return (
    (typeof draft.scanUrl === "string" || draft.scanUrl === null) &&
    (typeof draft.category === "string" || draft.category === null)
  );
}

export function loadOnboardingDraft(organizationId: string): OnboardingDraft | null {
  if (!organizationId) {
    return null;
  }

  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(getStorageKey(organizationId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return isOnboardingDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(organizationId: string, draft: OnboardingDraft) {
  if (!organizationId) {
    return;
  }

  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      getStorageKey(organizationId),
      JSON.stringify({
        scanUrl: draft.scanUrl ?? null,
        category: draft.category ?? null,
      }),
    );
  } catch {
    // sessionStorage unavailable - onboarding draft just won't persist for this tab
  }
}

export function clearOnboardingDraft(organizationId: string) {
  if (!organizationId) {
    return;
  }

  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(getStorageKey(organizationId));
  } catch {
    // sessionStorage unavailable - nothing else to do
  }
}
