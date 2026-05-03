import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { QueueCardView } from "../index";
import type { QueueCard } from "../../console-data";
import { ToastProvider } from "../../use-toast";

vi.mock("@/hooks/use-escalations");
vi.mock("@/hooks/use-escalation-reply");
vi.mock("@/hooks/use-approval-action");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

const escalation: QueueCard = {
  kind: "escalation",
  id: "card-e1",
  escalationId: "e1",
  agent: "alex",
  contactName: "n",
  channel: "email",
  timer: { label: "Urgent", ageDisplay: "1m" },
  issue: ["x"],
  primary: { label: "Reply" },
  secondary: { label: "Esc" },
  selfHandle: { label: "Self" },
};
const recommendation: QueueCard = {
  kind: "recommendation",
  id: "card-r1",
  agent: "nova",
  action: "do thing",
  timer: { label: "Immediate", confidence: "0.9" },
  dataLines: [["x"]],
  primary: { label: "Go" },
  secondary: { label: "Maybe" },
  dismiss: { label: "No" },
};
const approval: QueueCard = {
  kind: "approval_gate",
  id: "card-a1",
  approvalId: "a1",
  bindingHash: "bh",
  agent: "mira",
  jobName: "j",
  timer: { stageLabel: "s", ageDisplay: "1h" },
  stageProgress: "1/5",
  stageDetail: "d",
  countdown: "21h",
  primary: { label: "Approve" },
  stop: { label: "Stop" },
};

describe("QueueCardView dispatcher", () => {
  beforeEach(async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const apMod = await import("@/hooks/use-approval-action");
    vi.mocked(apMod.useApprovalAction).mockReturnValue({
      approve: vi.fn(),
      reject: vi.fn(),
      isPending: false,
      error: null,
    } as never);
  });

  it("dispatches escalation kind to EscalationCardView", () => {
    const { container } = wrap(
      <QueueCardView card={escalation} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard.escalation")).not.toBeNull();
  });

  it("dispatches recommendation kind", () => {
    const { container } = wrap(
      <QueueCardView card={recommendation} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard.recommendation")).not.toBeNull();
  });

  it("dispatches approval_gate kind", () => {
    const { container } = wrap(
      <QueueCardView card={approval} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard.approval-gate")).not.toBeNull();
  });

  it("forwards resolving prop to children", () => {
    const { container } = wrap(
      <QueueCardView card={recommendation} resolving={true} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard")?.classList.contains("is-resolving")).toBe(true);
  });
});
