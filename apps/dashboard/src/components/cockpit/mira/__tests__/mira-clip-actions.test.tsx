import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MiraReviewAction } from "@switchboard/core";

const mutate = vi.fn();
let halted = false;
vi.mock("@/hooks/use-creative-pipeline", () => ({
  useApproveStage: () => ({ mutate, isPending: false, isError: false }),
  useCostEstimate: () => ({
    data: { basic: { cost: 4, description: "" }, pro: { cost: 9, description: "" } },
  }),
}));
vi.mock("@/components/layout/halt/halt-context", () => ({ useHalt: () => ({ halted }) }));

import { MiraClipActions } from "../mira-clip-actions";

const reviewable: MiraReviewAction = { canContinue: true, canStop: true, label: "continue_draft" };

describe("MiraClipActions", () => {
  beforeEach(() => {
    mutate.mockReset();
    halted = false;
  });

  it("Continue requires confirm before mutating", () => {
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /continue draft/i }));
    expect(mutate).not.toHaveBeenCalled(); // opened the confirm, not the mutation
    fireEvent.click(screen.getByRole("button", { name: /confirm continue/i }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j1", action: "continue" }),
      expect.anything(),
    );
  });

  it("Stop requires an irreversible confirm", () => {
    render(<MiraClipActions jobId="j1" reviewAction={reviewable} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^stop draft$/i }));
    expect(screen.getByText(/can't be undone/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm stop/i }));
    expect(mutate).toHaveBeenCalledWith(
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
});
