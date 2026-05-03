import { fireEvent, render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EscalationCardView } from "../escalation-card";
import type { EscalationCard } from "../../console-data";

vi.mock("@/hooks/use-escalation-reply");
vi.mock("@/hooks/use-escalations");

const card: EscalationCard = {
  kind: "escalation",
  id: "card-e1",
  escalationId: "e1",
  agent: "alex",
  contactName: "Jane Doe",
  channel: "email",
  timer: { label: "Urgent", ageDisplay: "4 min ago" },
  issue: ["asked about return policy"],
  primary: { label: "Reply" },
  secondary: { label: "Escalate" },
  selfHandle: { label: "I'll handle" },
};

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

async function mockHooks() {
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
}

describe("EscalationCardView", () => {
  it("collapsed by default — no transcript or reply form", async () => {
    await mockHooks();
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".transcript-panel")).toBeNull();
    expect(container.querySelector(".reply-form")).toBeNull();
  });

  it("expands transcript + reply form on Reply inline click; caret rotates", async () => {
    const escMod = await import("@/hooks/use-escalations");
    vi.mocked(escMod.useEscalationDetail).mockReturnValue({
      data: { conversationHistory: [{ role: "lead", text: "hi", timestamp: "t" }] },
      isLoading: false,
      error: null,
    } as never);
    const replyMod = await import("@/hooks/use-escalation-reply");
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({
      send: vi.fn(),
      isPending: false,
    } as never);
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".esc-reply")!);
    expect(container.querySelector(".transcript-panel")).not.toBeNull();
    expect(container.querySelector(".reply-form")).not.toBeNull();
    expect(container.querySelector(".esc-reply")?.classList.contains("is-open")).toBe(true);
  });

  it("primary [Reply] button expands the panel and does NOT auto-send", async () => {
    await mockHooks();
    const replyMod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn();
    vi.mocked(replyMod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const onResolve = vi.fn();
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={onResolve} />,
    );
    expect(container.querySelector(".reply-form")).toBeNull();
    fireEvent.click(container.querySelector<HTMLButtonElement>(".btn-primary-coral")!);
    expect(container.querySelector(".reply-form")).not.toBeNull();
    expect(send).not.toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("renders id=q-${card.id} on the card root", async () => {
    await mockHooks();
    const { container } = wrap(
      <EscalationCardView card={card} resolving={false} onResolve={vi.fn()} />,
    );
    expect(container.querySelector("#q-card-e1")).not.toBeNull();
  });

  it("applies is-resolving class when resolving=true", async () => {
    await mockHooks();
    const { container } = wrap(
      <EscalationCardView card={card} resolving={true} onResolve={vi.fn()} />,
    );
    expect(container.querySelector(".qcard")?.classList.contains("is-resolving")).toBe(true);
  });
});
