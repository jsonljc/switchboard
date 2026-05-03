import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApprovalGateCardView } from "../approval-gate-card";
import type { ApprovalGateCard } from "../../console-data";

vi.mock("@/hooks/use-approval-action");

const card: ApprovalGateCard = {
  kind: "approval_gate",
  id: "card-a1",
  approvalId: "a1",
  bindingHash: "bh1",
  agent: "mira",
  jobName: "Whitening campaign",
  timer: { stageLabel: "Hooks ready", ageDisplay: "2h ago" },
  stageProgress: "Stage 2 of 5",
  stageDetail: "10 hooks ready",
  countdown: "gate closes in 21h",
  primary: { label: "Approve at stage 2" },
  stop: { label: "Stop job" },
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("ApprovalGateCardView", () => {
  it("primary calls approve(bindingHash) + onResolve", async () => {
    const mod = await import("@/hooks/use-approval-action");
    const approve = vi.fn().mockResolvedValue({});
    const reject = vi.fn();
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve,
      reject,
      isPending: false,
      error: null,
    } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")!);
    await waitFor(() => expect(approve).toHaveBeenCalledWith("bh1"));
    expect(onResolve).toHaveBeenCalled();
  });

  it("reject calls reject(bindingHash) + onResolve", async () => {
    const mod = await import("@/hooks/use-approval-action");
    const approve = vi.fn();
    const reject = vi.fn().mockResolvedValue({});
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve,
      reject,
      isPending: false,
      error: null,
    } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-ghost")!);
    await waitFor(() => expect(reject).toHaveBeenCalledWith("bh1"));
    expect(onResolve).toHaveBeenCalled();
  });

  it("shows .qerror row + leaves card on failure", async () => {
    const mod = await import("@/hooks/use-approval-action");
    const approve = vi.fn().mockRejectedValue(new Error("403 forbidden"));
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve,
      reject: vi.fn(),
      isPending: false,
      error: null,
    } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")!);
    await waitFor(() =>
      expect(container.querySelector(".qerror")?.textContent).toMatch(/403 forbidden/),
    );
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("disables both buttons while pending", async () => {
    const mod = await import("@/hooks/use-approval-action");
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve: vi.fn(),
      reject: vi.fn(),
      isPending: true,
      error: null,
    } as never);
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector<HTMLButtonElement>(".btn-primary-graphite")?.disabled).toBe(
      true,
    );
    expect(container.querySelector<HTMLButtonElement>(".btn-ghost")?.disabled).toBe(true);
  });

  it("renders id=q-${card.id} and stop button", async () => {
    const mod = await import("@/hooks/use-approval-action");
    vi.mocked(mod.useApprovalAction).mockReturnValue({
      approve: vi.fn(),
      reject: vi.fn(),
      isPending: false,
      error: null,
    } as never);
    const { container } = wrap(
      <ApprovalGateCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector("#q-card-a1")).not.toBeNull();
    expect(container.querySelector(".stop")?.textContent).toMatch(/Stop job/);
  });
});
