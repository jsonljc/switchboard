import { describe, it, expect, vi } from "vitest";
import { HandoffNotifier } from "./handoff-notifier.js";
import type { Handoff } from "./types.js";

function makePkg(agentSummary?: string): Handoff {
  return {
    id: "handoff_1",
    sessionId: "sess_1",
    organizationId: "org_1",
    reason: "negative_sentiment",
    status: "pending",
    leadSnapshot: { name: "Jane", channel: "whatsapp" },
    qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
    conversationSummary: {
      turnCount: 0,
      keyTopics: [],
      objectionHistory: [],
      sentiment: "angry",
      ...(agentSummary ? { agentSummary } : {}),
    },
    slaDeadlineAt: new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
  };
}

describe("HandoffNotifier agentSummary rendering (P2-9)", () => {
  it("renders the agent summary in the operator message", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const handoffNotifier = new HandoffNotifier({ notify } as never, async () => [
      "op@example.com",
    ]);
    await handoffNotifier.notify(
      makePkg("Lead is upset about a delayed reply and wants a callback"),
    );
    const arg = notify.mock.calls[0]![0] as { summary: string };
    expect(arg.summary).toContain("Lead is upset about a delayed reply and wants a callback");
  });

  it("omits the summary line when there is no agent summary", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const handoffNotifier = new HandoffNotifier({ notify } as never, async () => [
      "op@example.com",
    ]);
    await handoffNotifier.notify(makePkg());
    const arg = notify.mock.calls[0]![0] as { summary: string };
    expect(arg.summary).not.toContain("Summary:");
  });
});
