import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

import { RuleBasedInterpreter } from "../interpreter/interpreter.js";
import { guardInterpreterOutput } from "../interpreter/schema-guard.js";
import {
  verifySignature,
  checkTimestamp,
  checkNonce,
  checkIngressRateLimit,
} from "../adapters/security.js";
import { createConversation, transitionConversation } from "../conversation/state.js";

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------
describe("RuleBasedInterpreter", () => {
  const allActions = [
    "digital-ads.campaign.pause",
    "digital-ads.campaign.resume",
    "digital-ads.campaign.adjust_budget",
    "system.undo",
  ];

  let interpreter: RuleBasedInterpreter;

  beforeEach(() => {
    interpreter = new RuleBasedInterpreter();
  });

  it('parses "pause Summer Sale" -> ads.campaign.pause proposal', async () => {
    const result = await interpreter.interpret("pause Summer Sale", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.campaign.pause");
    expect(result.proposals[0]!.parameters).toEqual({ campaignRef: "Summer Sale" });
    expect(result.needsClarification).toBe(false);
  });

  it('parses "resume campaign X" -> ads.campaign.resume proposal', async () => {
    const result = await interpreter.interpret("resume campaign X", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.campaign.resume");
    expect(result.proposals[0]!.parameters).toEqual({ campaignRef: "X" });
    expect(result.needsClarification).toBe(false);
  });

  it('parses "set budget for Campaign A to $800" -> ads.budget.adjust with newBudget 800', async () => {
    const result = await interpreter.interpret("set budget for Campaign A to $800", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.campaign.adjust_budget");
    expect(result.proposals[0]!.parameters).toMatchObject({
      campaignRef: "Campaign A",
      newBudget: 800,
    });
  });

  it('parses "increase budget for X by $200" -> ads.budget.adjust with budgetChange 200', async () => {
    const result = await interpreter.interpret("increase budget for X by $200", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.campaign.adjust_budget");
    expect(result.proposals[0]!.parameters).toMatchObject({
      campaignRef: "X",
      budgetChange: 200,
    });
  });

  it('parses "decrease budget for X by $100" -> negative budgetChange', async () => {
    const result = await interpreter.interpret("decrease budget for X by $100", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("digital-ads.campaign.adjust_budget");
    expect(result.proposals[0]!.parameters).toMatchObject({
      campaignRef: "X",
      budgetChange: -100,
    });
  });

  it('parses "undo" -> system.undo proposal', async () => {
    const result = await interpreter.interpret("undo", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("system.undo");
    expect(result.confidence).toBe(1.0);
    expect(result.needsClarification).toBe(false);
  });

  it('parses "help" -> no proposals, no clarification', async () => {
    const result = await interpreter.interpret("help", {}, allActions);
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toBe(false);
    expect(result.clarificationQuestion).toBeNull();
    expect(result.confidence).toBe(1.0);
  });

  it("returns needsClarification for unknown intent", async () => {
    const result = await interpreter.interpret("show me something random", {}, allActions);
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toBeTruthy();
    expect(result.confidence).toBe(0);
  });

  it("assigns confidence 0.85 for matched patterns", async () => {
    const result = await interpreter.interpret("pause Spring Promo", {}, allActions);
    expect(result.confidence).toBe(0.85);
  });

  it("assigns confidence 0 for unmatched input", async () => {
    const result = await interpreter.interpret("do something weird", {}, allActions);
    expect(result.confidence).toBe(0);
  });

  it("returns needsClarification when action type is not in availableActions", async () => {
    const result = await interpreter.interpret("pause Summer Sale", {}, [
      "digital-ads.campaign.adjust_budget",
    ]);
    expect(result.proposals).toHaveLength(0);
    expect(result.needsClarification).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema Guard
// ---------------------------------------------------------------------------
describe("guardInterpreterOutput", () => {
  it("validates a well-formed interpreter output", () => {
    const validOutput = {
      proposals: [
        {
          id: "prop_1",
          actionType: "digital-ads.campaign.pause",
          parameters: { campaignRef: "Test" },
          evidence: "Matched",
          confidence: 0.85,
          originatingMessageId: "msg_1",
        },
      ],
      needsClarification: false,
      clarificationQuestion: null,
      confidence: 0.85,
    };

    const result = guardInterpreterOutput(validOutput);
    expect(result.valid).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it("returns invalid for malformed output", () => {
    const invalidOutput = {
      proposals: "not-an-array",
      needsClarification: "yes",
    };

    const result = guardInterpreterOutput(invalidOutput);
    expect(result.valid).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects confidence outside 0-1 range", () => {
    const badConfidence = {
      proposals: [],
      needsClarification: false,
      clarificationQuestion: null,
      confidence: 1.5,
    };

    const result = guardInterpreterOutput(badConfidence);
    expect(result.valid).toBe(false);
    expect(result.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Channel Security
// ---------------------------------------------------------------------------
describe("Channel Security", () => {
  const secret = "test-webhook-secret";

  describe("verifySignature", () => {
    it("passes with a valid HMAC-SHA256 signature", () => {
      const body = '{"event":"test"}';
      const expected = createHmac("sha256", secret).update(body).digest("hex");

      expect(verifySignature(body, expected, secret, "hmac-sha256")).toBe(true);
    });

    it("passes with sha256= prefixed signature", () => {
      const body = '{"event":"test"}';
      const expected = createHmac("sha256", secret).update(body).digest("hex");

      expect(verifySignature(body, `sha256=${expected}`, secret, "hmac-sha256")).toBe(true);
    });

    it("fails with an invalid signature", () => {
      const body = '{"event":"test"}';
      expect(verifySignature(body, "invalid-hex-value", secret, "hmac-sha256")).toBe(false);
    });
  });

  describe("checkTimestamp", () => {
    it("rejects a stale timestamp", () => {
      const staleSeconds = Math.floor(Date.now() / 1000) - 600; // 10 min ago
      const maxDrift = 300_000; // 5 min
      const result = checkTimestamp("x-timestamp", maxDrift, {
        "x-timestamp": String(staleSeconds),
      });
      expect(result).toBe(false);
    });

    it("accepts a fresh timestamp", () => {
      const freshSeconds = Math.floor(Date.now() / 1000);
      const maxDrift = 300_000;
      const result = checkTimestamp("x-timestamp", maxDrift, {
        "x-timestamp": String(freshSeconds),
      });
      expect(result).toBe(true);
    });
  });

  describe("checkNonce", () => {
    it("accepts a fresh nonce", async () => {
      const nonce = `nonce_${Date.now()}_${Math.random()}`;
      expect(await checkNonce(nonce, 60_000)).toBe(true);
    });

    it("rejects a duplicate nonce on second call", async () => {
      const nonce = `dup_nonce_${Date.now()}`;
      expect(await checkNonce(nonce, 60_000)).toBe(true);
      expect(await checkNonce(nonce, 60_000)).toBe(false);
    });
  });

  describe("checkIngressRateLimit", () => {
    it("allows requests within the rate limit", async () => {
      const key = `rate_ok_${Date.now()}`;
      const config = { windowMs: 60_000, maxRequests: 5 };
      expect(await checkIngressRateLimit(key, config)).toBe(true);
      expect(await checkIngressRateLimit(key, config)).toBe(true);
    });

    it("rejects requests exceeding the rate limit", async () => {
      const key = `rate_exceeded_${Date.now()}`;
      const config = { windowMs: 60_000, maxRequests: 2 };
      expect(await checkIngressRateLimit(key, config)).toBe(true);
      expect(await checkIngressRateLimit(key, config)).toBe(true);
      expect(await checkIngressRateLimit(key, config)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Conversation State
// ---------------------------------------------------------------------------
describe("Conversation State", () => {
  it("creates a conversation with initial active state", () => {
    const conv = createConversation("thread_1", "telegram", "user_1");
    expect(conv.status).toBe("active");
    expect(conv.threadId).toBe("thread_1");
    expect(conv.channel).toBe("telegram");
    expect(conv.principalId).toBe("user_1");
    expect(conv.currentIntent).toBeNull();
    expect(conv.pendingProposalIds).toHaveLength(0);
    expect(conv.pendingApprovalIds).toHaveLength(0);
    expect(conv.clarificationQuestion).toBeNull();
    expect(conv.id).toMatch(/^conv_/);
  });

  it("transitions to awaiting_clarification", () => {
    const conv = createConversation("t", "telegram", "u");
    const next = transitionConversation(conv, {
      type: "set_clarifying",
      question: "Which campaign?",
    });
    expect(next.status).toBe("awaiting_clarification");
    expect(next.clarificationQuestion).toBe("Which campaign?");
  });

  it("transitions to awaiting_approval", () => {
    const conv = createConversation("t", "telegram", "u");
    const next = transitionConversation(conv, {
      type: "set_awaiting_approval",
      approvalIds: ["appr_1", "appr_2"],
    });
    expect(next.status).toBe("awaiting_approval");
    expect(next.pendingApprovalIds).toEqual(["appr_1", "appr_2"]);
  });

  it("transitions to completed", () => {
    const conv = createConversation("t", "telegram", "u");
    const next = transitionConversation(conv, { type: "complete" });
    expect(next.status).toBe("completed");
  });

  it("transitions to expired", () => {
    const conv = createConversation("t", "telegram", "u");
    const next = transitionConversation(conv, { type: "expire" });
    expect(next.status).toBe("expired");
  });

  it("resumes back to active and clears clarification", () => {
    const conv = createConversation("t", "telegram", "u");
    const clarifying = transitionConversation(conv, {
      type: "set_clarifying",
      question: "Which one?",
    });
    expect(clarifying.status).toBe("awaiting_clarification");

    const resumed = transitionConversation(clarifying, { type: "resume" });
    expect(resumed.status).toBe("active");
    expect(resumed.clarificationQuestion).toBeNull();
  });
});
