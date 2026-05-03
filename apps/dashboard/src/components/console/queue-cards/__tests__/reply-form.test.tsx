import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ReplyForm } from "../reply-form";

vi.mock("@/hooks/use-escalation-reply");

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

describe("ReplyForm", () => {
  it("calls onSent and clears the textarea on 200 success", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn().mockResolvedValue({ ok: true, escalation: { id: "e1" } });
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const onSent = vi.fn();
    const { container, getByLabelText } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={onSent} />,
    );
    const textarea = getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "thanks!" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(textarea.value).toBe("");
  });

  it("preserves textarea and shows channel-aware error on 502", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        escalation: { id: "e1" },
        error: "channel delivery failed.",
      });
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const { container, getByLabelText } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={vi.fn()} />,
    );
    const textarea = getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "thanks!" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    await waitFor(() =>
      expect(container.querySelector(".reply-error")?.textContent).toMatch(
        /Couldn't deliver to email right now — channel delivery failed\./,
      ),
    );
    expect(textarea.value).toBe("thanks!");
  });

  it("preserves textarea and shows error message on thrown error", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn().mockRejectedValue(new Error("network down"));
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const { container, getByLabelText } = wrap(
      <ReplyForm escalationId="e1" channelName="sms" onSent={vi.fn()} />,
    );
    const textarea = getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "still here" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    await waitFor(() =>
      expect(container.querySelector(".reply-error")?.textContent).toMatch(/network down/),
    );
    expect(textarea.value).toBe("still here");
  });

  it("disables Send while pending", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    vi.mocked(mod.useEscalationReply).mockReturnValue({
      send: vi.fn().mockResolvedValue({ ok: true, escalation: { id: "e1" } }),
      isPending: true,
    } as never);
    const { container } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={vi.fn()} />,
    );
    expect(container.querySelector<HTMLButtonElement>(".reply-form-send")?.disabled).toBe(true);
  });

  it("does not submit empty text", async () => {
    const mod = await import("@/hooks/use-escalation-reply");
    const send = vi.fn();
    vi.mocked(mod.useEscalationReply).mockReturnValue({ send, isPending: false } as never);
    const { container } = wrap(
      <ReplyForm escalationId="e1" channelName="email" onSent={vi.fn()} />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".reply-form-send")!);
    expect(send).not.toHaveBeenCalled();
  });
});
