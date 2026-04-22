import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyPlaybook } from "@switchboard/schemas";

const useSessionMock = vi.fn();
const usePlaybookMock = vi.fn();
const useUpdatePlaybookMock = vi.fn();
const useManagedChannelsMock = vi.fn();
const useProvisionMock = vi.fn();
const useOnboardingDraftMock = vi.fn();
const useSimulationMock = vi.fn();
const saveDraftMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/hooks/use-playbook", () => ({
  usePlaybook: () => usePlaybookMock(),
  useUpdatePlaybook: () => useUpdatePlaybookMock(),
}));

vi.mock("@/hooks/use-managed-channels", () => ({
  useManagedChannels: () => useManagedChannelsMock(),
  useProvision: () => useProvisionMock(),
}));

vi.mock("@/hooks/use-onboarding-draft", () => ({
  useOnboardingDraft: () => useOnboardingDraftMock(),
}));

vi.mock("@/hooks/use-simulation", () => ({
  useSimulation: () => useSimulationMock(),
}));

vi.mock("@/lib/prompt-generator", () => ({
  generateTestPrompts: () => [],
}));

vi.mock("@/components/onboarding/onboarding-entry", () => ({
  OnboardingEntry: () => <div>entry</div>,
}));

vi.mock("@/components/onboarding/training-shell", () => ({
  TrainingShell: ({ onContinueManually }: { onContinueManually: () => void }) => (
    <button type="button" onClick={onContinueManually}>
      Continue manually
    </button>
  ),
}));

vi.mock("@/components/onboarding/test-center", () => ({
  TestCenter: () => <div>test center</div>,
}));

vi.mock("@/components/onboarding/go-live", () => ({
  GoLive: () => <div>go live</div>,
}));

import OnboardingPage from "../(auth)/onboarding/page";

describe("OnboardingPage", () => {
  it("clears the persisted scan URL when switching to manual fallback", () => {
    useSessionMock.mockReturnValue({
      data: { organizationId: "org_123" },
      status: "authenticated",
    });
    usePlaybookMock.mockReturnValue({
      data: { step: 2, playbook: createEmptyPlaybook() },
      isLoading: false,
      isError: false,
    });
    useUpdatePlaybookMock.mockReturnValue({ mutate: vi.fn() });
    useManagedChannelsMock.mockReturnValue({ data: { channels: [] } });
    useProvisionMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useOnboardingDraftMock.mockReturnValue({
      draft: { scanUrl: "https://example.com", category: null },
      isHydrated: true,
      saveDraft: saveDraftMock,
      clearDraft: vi.fn(),
    });
    useSimulationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(<OnboardingPage />);

    fireEvent.click(screen.getByRole("button", { name: /continue manually/i }));

    expect(saveDraftMock).toHaveBeenCalledWith({ scanUrl: null, category: null });
  });
});
