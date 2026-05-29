import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MiraCreativeDetailPage } from "../creative-detail-page";

vi.mock("@/hooks/use-creative-pipeline");

import { useCreativeJob, useApproveStage, useCostEstimate } from "@/hooks/use-creative-pipeline";

// Minimal job fixture — covers the happy path.
const baseJob = {
  id: "job-1",
  taskId: "task-1",
  organizationId: "org-1",
  deploymentId: "dep-1",
  productDescription: "Test Product",
  targetAudience: "Everyone",
  platforms: ["instagram"],
  brandVoice: null,
  productImages: [],
  references: [],
  pastPerformance: null,
  currentStage: "hooks",
  stoppedAt: null,
  stageOutputs: {},
  productionTier: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

const noopMutate = vi.fn();

function mockHooks({
  jobOverrides = {},
  jobQOverrides = {},
  approveOverrides = {},
  estimateData = null,
}: {
  jobOverrides?: Record<string, unknown>;
  jobQOverrides?: Record<string, unknown>;
  approveOverrides?: Record<string, unknown>;
  estimateData?: {
    basic: { cost: number; description: string };
    pro: { cost: number; description: string };
  } | null;
} = {}) {
  const job = { ...baseJob, ...jobOverrides };

  (useCreativeJob as ReturnType<typeof vi.fn>).mockReturnValue({
    isLoading: false,
    isError: false,
    data: job,
    ...jobQOverrides,
  });

  (useApproveStage as ReturnType<typeof vi.fn>).mockReturnValue({
    mutate: noopMutate,
    isPending: false,
    isError: false,
    ...approveOverrides,
  });

  (useCostEstimate as ReturnType<typeof vi.fn>).mockReturnValue({
    data: estimateData,
    isLoading: false,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  noopMutate.mockReset();
});

describe("MiraCreativeDetailPage", () => {
  describe("action button visibility", () => {
    it("hides action buttons when job is stopped", () => {
      mockHooks({ jobOverrides: { stoppedAt: "2026-05-02T00:00:00.000Z" } });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.queryByRole("button", { name: /continue draft/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /stop draft/i })).not.toBeInTheDocument();
      expect(screen.getByText(/this draft was stopped/i)).toBeInTheDocument();
    });

    it("hides action buttons when currentStage is complete", () => {
      mockHooks({ jobOverrides: { currentStage: "complete" } });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.queryByRole("button", { name: /continue draft/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /stop draft/i })).not.toBeInTheDocument();
      expect(screen.getByText(/draft completed/i)).toBeInTheDocument();
    });

    it("shows action buttons when job is active and not complete", () => {
      mockHooks();
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.getByRole("button", { name: /continue draft/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /stop draft/i })).toBeInTheDocument();
    });
  });

  describe("empty stageOutputs fallback", () => {
    it("renders 'No draft clip yet' when stageOutputs is empty", () => {
      mockHooks({ jobOverrides: { stageOutputs: {} } });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.getByText(/no draft clip yet/i)).toBeInTheDocument();
    });

    it("does not crash when stageOutputs is missing the production key", () => {
      mockHooks({ jobOverrides: { stageOutputs: { trends: { result: "ok" } } } });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.getByText(/no draft clip yet/i)).toBeInTheDocument();
    });
  });

  describe("confirm flow", () => {
    it("does NOT call mutate on a single 'Continue draft' click", async () => {
      const user = userEvent.setup();
      mockHooks();
      render(<MiraCreativeDetailPage id="job-1" />);
      await user.click(screen.getByRole("button", { name: /continue draft/i }));
      expect(noopMutate).not.toHaveBeenCalled();
    });

    it("calls mutate with action:'continue' after clicking Continue draft then Confirm continue", async () => {
      const user = userEvent.setup();
      mockHooks();
      render(<MiraCreativeDetailPage id="job-1" />);
      await user.click(screen.getByRole("button", { name: /continue draft/i }));
      await user.click(screen.getByRole("button", { name: /confirm continue/i }));
      expect(noopMutate).toHaveBeenCalledOnce();
      expect(noopMutate).toHaveBeenCalledWith({ jobId: "job-1", action: "continue" });
    });

    it("calls mutate with action:'stop' after clicking Stop draft then Confirm stop", async () => {
      const user = userEvent.setup();
      mockHooks();
      render(<MiraCreativeDetailPage id="job-1" />);
      await user.click(screen.getByRole("button", { name: /stop draft/i }));
      await user.click(screen.getByRole("button", { name: /confirm stop/i }));
      expect(noopMutate).toHaveBeenCalledOnce();
      expect(noopMutate).toHaveBeenCalledWith({ jobId: "job-1", action: "stop" });
    });

    it("does NOT call mutate when Cancel is clicked after Continue draft", async () => {
      const user = userEvent.setup();
      mockHooks();
      render(<MiraCreativeDetailPage id="job-1" />);
      await user.click(screen.getByRole("button", { name: /continue draft/i }));
      await user.click(screen.getByRole("button", { name: /cancel/i }));
      expect(noopMutate).not.toHaveBeenCalled();
    });
  });

  describe("error states", () => {
    it("renders mutation error message when approve.isError is true", () => {
      mockHooks({ approveOverrides: { isError: true } });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.getByText(/couldn't update the draft/i)).toBeInTheDocument();
    });

    it("renders load error message when jobQ.isError is true", () => {
      (useCreativeJob as ReturnType<typeof vi.fn>).mockReturnValue({
        isLoading: false,
        isError: true,
        data: undefined,
      });
      (useApproveStage as ReturnType<typeof vi.fn>).mockReturnValue({
        mutate: noopMutate,
        isPending: false,
        isError: false,
      });
      (useCostEstimate as ReturnType<typeof vi.fn>).mockReturnValue({
        data: null,
        isLoading: false,
      });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.getByText(/couldn't load this draft/i)).toBeInTheDocument();
    });

    it("renders 'Draft not found' only when no error and no job data", () => {
      (useCreativeJob as ReturnType<typeof vi.fn>).mockReturnValue({
        isLoading: false,
        isError: false,
        data: undefined,
      });
      (useApproveStage as ReturnType<typeof vi.fn>).mockReturnValue({
        mutate: noopMutate,
        isPending: false,
        isError: false,
      });
      (useCostEstimate as ReturnType<typeof vi.fn>).mockReturnValue({
        data: null,
        isLoading: false,
      });
      render(<MiraCreativeDetailPage id="job-1" />);
      expect(screen.getByText(/draft not found/i)).toBeInTheDocument();
      // Must NOT show the load-error copy for a genuine not-found
      expect(screen.queryByText(/couldn't load this draft/i)).not.toBeInTheDocument();
    });
  });
});
