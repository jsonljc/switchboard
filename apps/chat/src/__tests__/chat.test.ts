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
import {
  createConversation,
  transitionConversation,
} from "../conversation/state.js";
import { composeDenialReply, composeExecutionResult } from "../composer/reply.js";
import { buildApprovalCard } from "../composer/approval-card.js";

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------
describe("RuleBasedInterpreter", () => {
  const allActions = [
    "ads.campaign.pause",
    "ads.campaign.resume",
    "ads.budget.adjust",
    "system.undo",
  ];

  let interpreter: RuleBasedInterpreter;

  beforeEach(() => {
    interpreter = new RuleBasedInterpreter();
  });

  it('parses "pause Summer Sale" -> ads.campaign.pause proposal', async () => {
    const result = await interpreter.interpret("pause Summer Sale", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("ads.campaign.pause");
    expect(result.proposals[0]!.parameters).toEqual({ campaignRef: "Summer Sale" });
    expect(result.needsClarification).toBe(false);
  });

  it('parses "resume campaign X" -> ads.campaign.resume proposal', async () => {
    const result = await interpreter.interpret("resume campaign X", {}, allActions);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("ads.campaign.resume");
    expect(result.proposals[0]!.parameters).toEqual({ campaignRef: "X" });
    expect(result.needsClarification).toBe(false);
  });

  it('parses "set budget for Campaign A to $800" -> ads.budget.adjust with newBudget 800', async () => {
    const result = await interpreter.interpret(
      "set budget for Campaign A to $800",
      {},
      allActions,
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("ads.budget.adjust");
    expect(result.proposals[0]!.parameters).toMatchObject({
      campaignRef: "Campaign A",
      newBudget: 800,
    });
  });

  it('parses "increase budget for X by $200" -> ads.budget.adjust with budgetChange 200', async () => {
    const result = await interpreter.interpret(
      "increase budget for X by $200",
      {},
      allActions,
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("ads.budget.adjust");
    expect(result.proposals[0]!.parameters).toMatchObject({
      campaignRef: "X",
      budgetChange: 200,
    });
  });

  it('parses "decrease budget for X by $100" -> negative budgetChange', async () => {
    const result = await interpreter.interpret(
      "decrease budget for X by $100",
      {},
      allActions,
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]!.actionType).toBe("ads.budget.adjust");
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
    const result = await interpreter.interpret(
      "show me something random",
      {},
      allActions,
    );
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
      "ads.budget.adjust",
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
          actionType: "ads.campaign.pause",
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

      expect(
        verifySignature(body, `sha256=${expected}`, secret, "hmac-sha256"),
      ).toBe(true);
    });

    it("fails with an invalid signature", () => {
      const body = '{"event":"test"}';
      expect(
        verifySignature(body, "invalid-hex-value", secret, "hmac-sha256"),
      ).toBe(false);
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
    it("accepts a fresh nonce", () => {
      const nonce = `nonce_${Date.now()}_${Math.random()}`;
      expect(checkNonce(nonce, 60_000)).toBe(true);
    });

    it("rejects a duplicate nonce on second call", () => {
      const nonce = `dup_nonce_${Date.now()}`;
      expect(checkNonce(nonce, 60_000)).toBe(true);
      expect(checkNonce(nonce, 60_000)).toBe(false);
    });
  });

  describe("checkIngressRateLimit", () => {
    it("allows requests within the rate limit", () => {
      const key = `rate_ok_${Date.now()}`;
      const config = { windowMs: 60_000, maxRequests: 5 };
      expect(checkIngressRateLimit(key, config)).toBe(true);
      expect(checkIngressRateLimit(key, config)).toBe(true);
    });

    it("rejects requests exceeding the rate limit", () => {
      const key = `rate_exceeded_${Date.now()}`;
      const config = { windowMs: 60_000, maxRequests: 2 };
      expect(checkIngressRateLimit(key, config)).toBe(true);
      expect(checkIngressRateLimit(key, config)).toBe(true);
      expect(checkIngressRateLimit(key, config)).toBe(false);
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

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
describe("Composer", () => {
  describe("composeDenialReply", () => {
    it("includes check details in the denial reply", () => {
      const trace = {
        actionId: "act_1",
        envelopeId: "env_1",
        checks: [
          {
            checkCode: "SPEND_LIMIT" as const,
            checkData: { limit: 500 },
            humanDetail: "Budget exceeds daily spend limit of $500",
            matched: true,
            effect: "deny" as const,
          },
        ],
        computedRiskScore: {
          rawScore: 75,
          category: "high" as const,
          factors: [],
        },
        finalDecision: "deny" as const,
        approvalRequired: "none" as const,
        explanation: "Action denied due to spend limit violation",
        evaluatedAt: new Date(),
      };

      const reply = composeDenialReply(trace);
      expect(reply).toContain("Blocked");
      expect(reply).toContain("Action denied due to spend limit violation");
      expect(reply).toContain("SPEND_LIMIT");
      expect(reply).toContain("Budget exceeds daily spend limit of $500");
    });

    it("handles denial with no matching deny check gracefully", () => {
      const trace = {
        actionId: "act_2",
        envelopeId: "env_2",
        checks: [
          {
            checkCode: "RISK_SCORING" as const,
            checkData: {},
            humanDetail: "Risk is medium",
            matched: false,
            effect: "allow" as const,
          },
        ],
        computedRiskScore: {
          rawScore: 50,
          category: "medium" as const,
          factors: [],
        },
        finalDecision: "deny" as const,
        approvalRequired: "none" as const,
        explanation: "Generic denial",
        evaluatedAt: new Date(),
      };

      const reply = composeDenialReply(trace);
      expect(reply).toContain("Blocked");
      expect(reply).toContain("Generic denial");
    });
  });

  describe("buildApprovalCard", () => {
    it("builds an approval card with correct buttons", () => {
      const card = buildApprovalCard(
        "Pause Summer Sale campaign",
        "medium",
        "Pausing an active campaign",
        "appr_123",
        "hash_abc",
      );

      expect(card.summary).toContain("Pause Summer Sale campaign");
      expect(card.riskCategory).toBe("medium");
      expect(card.explanation).toContain("MEDIUM");
      expect(card.explanation).toContain("Pausing an active campaign");
      expect(card.buttons).toHaveLength(3);

      const labels = card.buttons.map((b) => b.label);
      expect(labels).toContain("Approve");
      expect(labels).toContain("Reject");
      expect(labels).toContain("Approve capped at +20%");

      // Verify callback data is valid JSON
      for (const btn of card.buttons) {
        const data = JSON.parse(btn.callbackData) as Record<string, unknown>;
        expect(typeof data["action"]).toBe("string");
      }

      // Verify approve button includes bindingHash
      const approveBtn = card.buttons.find((b) => b.label === "Approve")!;
      const approveData = JSON.parse(approveBtn.callbackData) as Record<string, unknown>;
      expect(approveData["approvalId"]).toBe("appr_123");
      expect(approveData["bindingHash"]).toBe("hash_abc");
    });
  });

  describe("composeExecutionResult", () => {
    it("includes undo info for a successful result", () => {
      const reply = composeExecutionResult(
        "Campaign paused successfully",
        true,
        "audit_xyz",
        "medium",
        true,
        "user@example.com",
      );
      expect(reply).toContain("Done");
      expect(reply).toContain("Campaign paused successfully");
      expect(reply).toContain("audit_xyz");
      expect(reply).toContain("MEDIUM");
      expect(reply).toContain("undo");
      expect(reply).toContain("user@example.com");
    });

    it("marks failed execution correctly", () => {
      const reply = composeExecutionResult(
        "Campaign pause failed",
        false,
        "audit_fail",
        "high",
        false,
        "admin@example.com",
      );
      expect(reply).toContain("Failed");
      expect(reply).toContain("Campaign pause failed");
      expect(reply).not.toContain("undo");
    });
  });
});
