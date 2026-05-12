import { describe, expect, it, vi } from "vitest";
import { WhatsAppWindowGateHook } from "./whatsapp-window-gate.js";
import type { SkillExecutionResult, SkillHookContext } from "../types.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-05-12T10:00:00Z");
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
    },
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    verdictStore: { save: vi.fn().mockResolvedValue(undefined) },
    handoffStore: { save: vi.fn().mockResolvedValue(undefined) },
    governanceConfigResolver: {
      resolve: vi.fn().mockResolvedValue({
        whatsappWindow: {
          enabled: true,
          mode: "enforce",
          jurisdiction: "SG",
          allowMarketingTemplateSubstitution: false,
        },
      }),
    },
    postureCache: { get: vi.fn(), remember: vi.fn() },
    threadStore: {
      getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(new Date(NOW.getTime() - 60 * 60 * 1000)), // 1h ago
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

describe("WhatsAppWindowGateHook — inside window", () => {
  it("passes inside-window emit through unchanged", async () => {
    const deps = makeDeps();
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    const before = result.response;

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe(before);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGuard: "whatsapp_window",
        action: "allow",
        reasonCode: "allowed",
      }),
    );
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
  });
});

describe("WhatsAppWindowGateHook — outside window", () => {
  const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000); // 25h ago

  it("substitutes when opt-in granted and template matches", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    // This test relies on an "approved" appointment-confirm SG template existing in the registry.
    // The default v1 stubs are all approvalStatus="draft", so we expect this to be
    // a template_not_approved block — NOT a substitute — until the registry has approved entries.
    // (Task 4 + 5 produced draft-only entries by design.) See "blocks + handoffs when the matched
    // template is not approved" below for the actual default-state assertion.
    //
    // For the substitute happy path, we need to either:
    //   (a) mutate WHATSAPP_TEMPLATES in this test (intrusive, breaks other tests),
    //   (b) use a fixture/mock to bypass selectTemplate, or
    //   (c) flip the SG appointment-confirm entry to approvalStatus="approved" in setup.
    //
    // Use option (c) here: temporarily mutate the entry's approvalStatus, run the assertion,
    // restore. This is acceptable for a single test since the registry is a const array of
    // mutable interior objects — be sure to restore in the finally block.

    const { WHATSAPP_TEMPLATES } = await import("../templates/whatsapp-registry.js");
    const target = WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === "appointment-confirm" && t.jurisdiction === "SG",
    );
    if (!target) throw new Error("test setup: SG appointment-confirm template missing");
    const originalStatus = target.approvalStatus;
    (target as { approvalStatus: string }).approvalStatus = "approved";
    try {
      await hook.afterSkill!(makeCtx(), result);

      expect(result.response).not.toBe("Hi there, see you tomorrow.");
      expect(deps.verdictStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceGuard: "whatsapp_window",
          action: "substitute",
          reasonCode: "outside_whatsapp_window",
          details: expect.objectContaining({
            templateMatch: "matched",
            templateCategory: "utility",
            recipientMarket: "SG",
            costRisk: "paid_template_message",
            costEstimateStatus: "not_priced_in_1d",
          }),
        }),
      );
      expect(deps.handoffStore.save).not.toHaveBeenCalled();
    } finally {
      (target as { approvalStatus: string }).approvalStatus = originalStatus;
    }
  });

  it("blocks + handoffs when opt-in missing", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      contactStore: { getMessagingOptInForThread: vi.fn().mockResolvedValue(false) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe("");
    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "outside_whatsapp_window",
        metadata: expect.objectContaining({ blockSubCause: "missing_opt_in" }),
      }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({
          windowStatus: "outside",
          optInStatus: "missing_or_false",
        }),
      }),
    );
  });

  it("blocks + handoffs when intentClass missing", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult(); // no intentClass

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ blockSubCause: "missing_intent_class" }),
      }),
    );
  });

  it("blocks + handoffs when no template matches the intent/jurisdiction", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: true,
            mode: "enforce",
            jurisdiction: "XX",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ blockSubCause: "no_template_fit" }),
      }),
    );
  });

  it("blocks + handoffs when the matched template is not approved", async () => {
    // All v1 templates ship as approvalStatus="draft" — this is the default-state assertion.
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.handoffStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "outside_whatsapp_window",
        metadata: expect.objectContaining({
          blockSubCause: "template_not_approved",
          templateName: expect.any(String),
          metaTemplateName: expect.any(String),
        }),
      }),
    );
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({
          templateMatch: "template_not_approved",
          approvalStatus: "draft",
        }),
      }),
    );
  });

  it("blocks + handoffs when matched template is marketing-category and flag is off (default)", async () => {
    // re-engagement-offer entry must be approved for this test to exercise the marketing-category
    // check (not the approval check). Temporarily flip.
    const { WHATSAPP_TEMPLATES } = await import("../templates/whatsapp-registry.js");
    const target = WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === "re-engagement-offer" && t.jurisdiction === "SG",
    );
    if (!target) throw new Error("test setup: re-engagement-offer SG template missing");
    const originalStatus = target.approvalStatus;
    (target as { approvalStatus: string }).approvalStatus = "approved";
    try {
      const deps = makeDeps({
        threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
        // governanceConfigResolver default already sets allowMarketingTemplateSubstitution: false.
      });
      const hook = new WhatsAppWindowGateHook(deps as never);
      const result = makeResult({ intentClass: "re-engagement-offer" });

      await hook.afterSkill!(makeCtx(), result);

      expect(deps.handoffStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "outside_whatsapp_window",
          metadata: expect.objectContaining({
            blockSubCause: "marketing_substitution_blocked",
            templateCategory: "marketing",
          }),
        }),
      );
      expect(deps.verdictStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "block",
          details: expect.objectContaining({
            templateMatch: "marketing_substitution_blocked",
            templateCategory: "marketing",
            recipientMarket: "SG",
            costRisk: "paid_template_message",
            costEstimateStatus: "not_priced_in_1d",
          }),
        }),
      );
    } finally {
      (target as { approvalStatus: string }).approvalStatus = originalStatus;
    }
  });

  it("substitutes when matched marketing template AND allowMarketingTemplateSubstitution is true", async () => {
    const { WHATSAPP_TEMPLATES } = await import("../templates/whatsapp-registry.js");
    const target = WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === "re-engagement-offer" && t.jurisdiction === "SG",
    );
    if (!target) throw new Error("test setup: re-engagement-offer SG template missing");
    const originalStatus = target.approvalStatus;
    (target as { approvalStatus: string }).approvalStatus = "approved";
    try {
      const deps = makeDeps({
        threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
        governanceConfigResolver: {
          resolve: vi.fn().mockResolvedValue({
            whatsappWindow: {
              enabled: true,
              mode: "enforce",
              jurisdiction: "SG",
              allowMarketingTemplateSubstitution: true,
            },
          }),
        },
      });
      const hook = new WhatsAppWindowGateHook(deps as never);
      const result = makeResult({ intentClass: "re-engagement-offer" });

      await hook.afterSkill!(makeCtx(), result);

      expect(deps.verdictStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "substitute",
          details: expect.objectContaining({ templateCategory: "marketing" }),
        }),
      );
      expect(deps.handoffStore.save).not.toHaveBeenCalled();
    } finally {
      (target as { approvalStatus: string }).approvalStatus = originalStatus;
    }
  });
});

describe("WhatsAppWindowGateHook — cost-annotation contract", () => {
  const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);

  it("every substitute verdict carries the five mandatory cost fields", async () => {
    const { WHATSAPP_TEMPLATES } = await import("../templates/whatsapp-registry.js");
    const target = WHATSAPP_TEMPLATES.find(
      (t) => t.intentClass === "appointment-confirm" && t.jurisdiction === "SG",
    );
    if (!target) throw new Error("test setup: SG appointment-confirm template missing");
    const originalStatus = target.approvalStatus;
    (target as { approvalStatus: string }).approvalStatus = "approved";
    try {
      const deps = makeDeps({
        threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      });
      const hook = new WhatsAppWindowGateHook(deps as never);
      const result = makeResult({ intentClass: "appointment-confirm" });

      await hook.afterSkill!(makeCtx(), result);

      const substituteCall = (deps.verdictStore.save as ReturnType<typeof vi.fn>).mock.calls.find(
        ([arg]) => (arg as { action?: string }).action === "substitute",
      );
      expect(substituteCall, "expected exactly one substitute verdict").toBeDefined();
      const verdict = (substituteCall as [{ details: Record<string, unknown> }])[0];
      expect(verdict.details).toEqual(
        expect.objectContaining({
          templateCategory: expect.any(String),
          recipientMarket: expect.any(String),
          metaTemplateName: expect.any(String),
          costRisk: "paid_template_message",
          costEstimateStatus: "not_priced_in_1d",
        }),
      );
    } finally {
      (target as { approvalStatus: string }).approvalStatus = originalStatus;
    }
  });
});

describe("WhatsAppWindowGateHook — mode and flag", () => {
  const farPast = new Date(NOW.getTime() - 25 * 60 * 60 * 1000);

  it("observe mode emits verdict but does not mutate response or handoff", async () => {
    // Use a path that wouldn't substitute even in enforce (missing intentClass) so we test
    // the mode-specific behavior cleanly: in observe, no handoff is created.
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(farPast) },
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: true,
            mode: "observe",
            jurisdiction: "SG",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult(); // no intentClass → block path
    const before = result.response;

    await hook.afterSkill!(makeCtx(), result);

    expect(result.response).toBe(before); // observe leaves response untouched
    expect(deps.handoffStore.save).not.toHaveBeenCalled(); // observe does not handoff
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "block" }), // verdict still emitted
    );
  });

  it("feature flag off → passthrough, no verdict", async () => {
    const deps = makeDeps({
      governanceConfigResolver: {
        resolve: vi.fn().mockResolvedValue({
          whatsappWindow: {
            enabled: false,
            mode: "enforce",
            jurisdiction: "SG",
            allowMarketingTemplateSubstitution: false,
          },
        }),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult({ intentClass: "appointment-confirm" });

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.verdictStore.save).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
  });

  it("non-whatsapp channel → passthrough, no verdict", async () => {
    const deps = makeDeps({
      channelTypeResolver: { resolve: vi.fn().mockResolvedValue("telegram") },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();

    await hook.afterSkill!(makeCtx(), result);

    expect(deps.verdictStore.save).not.toHaveBeenCalled();
  });
});

describe("WhatsAppWindowGateHook — window edge cases", () => {
  it("23:59:59 ago → inside", async () => {
    const deps = makeDeps({
      threadStore: {
        getLastWhatsAppInboundAt: vi
          .fn()
          .mockResolvedValue(new Date(NOW.getTime() - (24 * 60 * 60 * 1000 - 1000))),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow" }),
    );
  });

  it("24:00:01 ago → outside", async () => {
    // outside-window + no intent → block (default state of registry has nothing approved).
    const deps = makeDeps({
      threadStore: {
        getLastWhatsAppInboundAt: vi
          .fn()
          .mockResolvedValue(new Date(NOW.getTime() - (24 * 60 * 60 * 1000 + 1000))),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult(); // no intentClass
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({ windowStatus: "outside" }),
      }),
    );
  });

  it("lastWhatsAppInboundAt null → outside", async () => {
    const deps = makeDeps({
      threadStore: { getLastWhatsAppInboundAt: vi.fn().mockResolvedValue(null) },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        details: expect.objectContaining({ windowStatus: "outside" }),
      }),
    );
  });
});

describe("WhatsAppWindowGateHook — fail closed", () => {
  it("blocks on resolver error with no cached posture", async () => {
    const deps = makeDeps({
      governanceConfigResolver: { resolve: vi.fn().mockRejectedValue(new Error("boom")) },
      postureCache: { get: vi.fn().mockReturnValue(undefined), remember: vi.fn() },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "block",
        reasonCode: "governance_unavailable",
      }),
    );
  });

  it("uses cached posture when resolver errors", async () => {
    const deps = makeDeps({
      governanceConfigResolver: { resolve: vi.fn().mockRejectedValue(new Error("boom")) },
      postureCache: {
        get: vi.fn().mockReturnValue({
          enabled: true,
          mode: "enforce",
          jurisdiction: "SG",
          allowMarketingTemplateSubstitution: false,
        }),
        remember: vi.fn(),
      },
    });
    const hook = new WhatsAppWindowGateHook(deps as never);
    const result = makeResult();
    await hook.afterSkill!(makeCtx(), result);
    expect(deps.verdictStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ action: "allow" }),
    );
  });
});
