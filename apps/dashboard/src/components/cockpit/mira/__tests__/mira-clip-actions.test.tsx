import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MiraReviewAction } from "@switchboard/core";

let approveMock: { mutate: ReturnType<typeof vi.fn>; isPending: boolean; isError: boolean };
beforeEach(() => {
  approveMock = { mutate: vi.fn(), isPending: false, isError: false };
});

const decideMock = vi.fn().mockResolvedValue({ id: "j", decision: "kept" });
vi.mock("@/hooks/use-review-decision", () => ({
  useReviewDecision: () => ({ mutate: decideMock, isPending: false, isError: false }),
}));

let halted = false;
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => approveMock,
  useCostEstimate: () => ({
    data: { basic: { cost: 4, description: "" }, pro: { cost: 9, description: "" } },
  }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({ useHalt: () => ({ halted }) }));

import { MiraClipActions } from "../mira-clip-actions";

const reviewable: MiraReviewAction = { canContinue: true, canStop: true, label: "continue_draft" };

describe("MiraClipActions", () => {
  beforeEach(() => {
    halted = false;
  });

  it("Continue requires confirm before mutating", () => {
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /continue draft/i }));
    expect(approveMock.mutate).not.toHaveBeenCalled(); // opened the confirm, not the mutation
    fireEvent.click(screen.getByRole("button", { name: /confirm continue/i }));
    expect(approveMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", action: "continue" }),
      expect.anything(),
    );
  });

  it("Stop requires an irreversible confirm", () => {
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^stop draft$/i }));
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm stop/i }));
    expect(approveMock.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", action: "stop" }),
      expect.anything(),
    );
  });

  it("halted: Continue disabled + labeled, Stop still available", () => {
    halted = true;
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    expect(screen.getByRole("button", { name: /halted/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^stop draft$/i })).toBeEnabled();
  });

  it("continue success resolves the clip", () => {
    approveMock.mutate = vi.fn((_args, opts) => opts?.onSuccess?.());
    const onResolve = vi.fn();
    render(<MiraClipActions jobId="j2" reviewAction={reviewable} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /continue draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm continue/i }));
    expect(onResolve).toHaveBeenCalledWith("j2");
  });

  it("mutation error shows an inline message and does NOT resolve", () => {
    approveMock.mutate = vi.fn((_args, opts) => opts?.onError?.());
    approveMock.isError = true;
    const onResolve = vi.fn();
    render(<MiraClipActions jobId="j3" reviewAction={reviewable} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /continue draft/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm continue/i }));
    expect(screen.getByText(/try again/i)).toBeInTheDocument();
    expect(onResolve).not.toHaveBeenCalled();
  });
});

describe("MiraClipActions — Keep/Pass on review_draft", () => {
  beforeEach(() => decideMock.mockClear());
  const reviewable = { canContinue: false, canStop: false, label: "review_draft" as const };

  it("renders Keep + Pass (not Continue/Stop) for a draft_ready clip", () => {
    render(<MiraClipActions jobId="j" reviewAction={reviewable} onResolve={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^keep/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pass/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue/i })).not.toBeInTheDocument();
  });

  it("keeps the draft and resolves the clip", () => {
    const onResolve = vi.fn();
    render(<MiraClipActions jobId="j" reviewAction={reviewable} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole("button", { name: /^keep/i }));
    expect(decideMock).toHaveBeenCalledWith({ id: "j", decision: "kept" }, expect.anything());
  });
});
