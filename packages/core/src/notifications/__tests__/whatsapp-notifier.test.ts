import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhatsAppApprovalNotifier } from "../whatsapp-notifier.js";
import type { ApprovalNotification } from "../notifier.js";

const FIXED_FUTURE = new Date("2030-01-01T00:00:00.000Z");

function makeNotification(overrides: Partial<ApprovalNotification> = {}): ApprovalNotification {
  return {
    approvalId: "appr_abc",
    envelopeId: "env_xyz",
    summary: "Test approval summary",
    explanation: "Test explanation",
    riskCategory: "high",
    bindingHash: "hash_abc",
    expiresAt: FIXED_FUTURE,
    approvers: ["+15551230000"],
    evidenceBundle: {},
    ...overrides,
  };
}

describe("WhatsAppApprovalNotifier default API version", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses v21.0 when no apiVersion is specified", async () => {
    const notifier = new WhatsAppApprovalNotifier({ token: "tok", phoneNumberId: "phone_9" });

    await notifier.notify(makeNotification());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/phone_9/messages");
  });
});
