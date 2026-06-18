import { describe, expect, it, vi } from "vitest";
// Split from whatsapp-window-gate.test.ts (at the 600-line max-lines gate). These
// cases pin the org-resolvable template-approval source: a per-org overlay that flips
// a static draft registry entry to "approved" so a Meta-approved template can send,
// while a non-approved overlay (or none) keeps the gate blocking.
import { WhatsAppWindowGateHook } from "./whatsapp-window-gate.js";
import { selectTemplate } from "../templates/whatsapp-registry.js";
import type { SkillExecutionResult, SkillHookContext } from "../types.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-12T10:00:00Z");
const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000); // 25h ago
const clock = () => NOW;

function makeCtx(): SkillHookContext {
  return {
    deploymentId: "dep_test",
    orgId: "org_test",
    skillSlug: "alex-sg-my",
    skillVersion: "1.0.0",
    sessionId: "thread_test",
    trustLevel: "guided",
    trustScore: 0.8,
  };
}

function makeResult(overrides: Partial<SkillExecutionResult> = {}): SkillExecutionResult {
  return {
    response: "Hi there, see you tomorrow.",
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    trace: {
      durationMs: 0,
      turnCount: 1,
      status: "success",
      responseSummary: "",
      writeCount: 0,
      governanceDecisions: [],
      qualificationSignals: null,
    },
    ...overrides,
  };
}

function makeGovernanceResolver(whatsappWindow: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    status: "resolved",
    config: {
      jurisdiction: whatsappWindow["jurisdiction"] ?? "SG",
      clinicType: "medical",
      whatsappWindow,
    },
  });
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    verdictStore: { save: vi.fn().mockResolvedValue(undefined) },
    handoffStore: { save: vi.fn().mockResolvedValue(undefined) },
    governanceConfigResolver: makeGovernanceResolver({
      enabled: true,
      mode: "enforce",
      jurisdiction: "SG",
      allowMarketingTemplateSubstitution: false,
    }),
    postureCache: { lastKnown: vi.fn(), remember: vi.fn() },
    threadStore: {
      getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast),
    },
    contactStore: {
      getMessagingOptInForThread: vi.fn().mockResolvedValue(true),
    },
    channelTypeResolver: {
      resolve: vi.fn().mockResolvedValue("whatsapp"),
    },
    clock,
    windowMs: WINDOW_MS,
    ...overrides,
  };
}

describe("WhatsAppWindowGateHook — org-resolvable template-approval source", () => {
  it("sends when the approval source flips a static draft template to approved", async () => {
    // The static SG appointment-confirm template ships as draft. An org whose
    // template-approval source reports the Meta name as "approved" must substitute.
    const sgConfirm = selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "SG" });
    if (!sgConfirm) throw new Error("test setup: SG appointment-confirm template missing");
    expect(sgConfirm.approvalStatus).toBe("draft");

    const templateApprovalSource = {
      resolve: vi.fn().mockResolvedValue({ [sgConfirm.metaTemplateName]: "approved" }),
    };
    const deps = makeDeps({ templateApprovalSource });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(templateApprovalSource.resolve).toHaveBeenCalledWith("dep_test");
    expect(result.response).toBe(sgConfirm.body);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "template_required",
        reasonCode: "outside_whatsapp_window",
      }),
    );
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
    // The overlay must not mutate the shared static registry.
    expect(sgConfirm.approvalStatus).toBe("draft");
  });

  it("still blocks when the approval source reports a non-approved status", async () => {
    const sgConfirm = selectTemplate({ intentClass: "appointment-confirm", jurisdiction: "SG" });
    if (!sgConfirm) throw new Error("test setup: SG appointment-confirm template missing");

    const templateApprovalSource = {
      resolve: vi.fn().mockResolvedValue({ [sgConfirm.metaTemplateName]: "submitted" }),
    };
    const deps = makeDeps({ templateApprovalSource });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe("");
    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "outside_whatsapp_window" }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "block", reasonCode: "outside_whatsapp_window" }),
    );
  });

  it("blocks by default when no approval source is wired (static draft governs)", async () => {
    // No templateApprovalSource dep at all → the static registry default (draft) applies.
    const deps = makeDeps();
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe("");
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "block", reasonCode: "outside_whatsapp_window" }),
    );
  });

  it("treats an approval-source throw as no signal (blocks; does not crash the gate)", async () => {
    const templateApprovalSource = {
      resolve: vi.fn().mockRejectedValue(new Error("store down")),
    };
    const deps = makeDeps({ templateApprovalSource });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    // Fails to the static default (draft) → block + handoff, not a thrown error path.
    expect(result.response).toBe("");
    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "outside_whatsapp_window" }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "block", reasonCode: "outside_whatsapp_window" }),
    );
  });
});
