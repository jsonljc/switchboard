import { describe, it, expect, vi } from "vitest";
import { executeScheduledFollowUpDispatch } from "../../cron/scheduled-follow-up-dispatch.js";
import { buildConversationFollowUpSendWorkflow } from "../conversation-followup-send-workflow.js";

/**
 * Producer-population proof: with today's real WHATSAPP_TEMPLATES (all draft),
 * an opted-in, consented, out-of-window contact still results in NO send — the
 * gate fails closed with template_not_approved. Guards the whole pipeline
 * against an accidental ungated send if a producer/default changes.
 */
describe("follow-up fail-closed integration", () => {
  it("a fully-eligible-except-template contact is skipped, never sent", async () => {
    const handler = buildConversationFollowUpSendWorkflow({
      // NOTE: no selectTemplateFn → uses the REAL registry (all draft today).
      allowMarketingTemplate: true,
      getSendContext: vi.fn().mockResolvedValue({
        consentGrantedAt: "2026-05-01T00:00:00.000Z",
        consentRevokedAt: null,
        pdpaJurisdiction: "SG",
        messagingOptIn: true,
        lastWhatsAppInboundAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        jurisdiction: "SG",
        leadName: "Jane",
        businessName: "Glow Clinic",
        phone: "+6591234567",
      }),
    });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const markSkipped = vi.fn();
    const markSent = vi.fn();
    const markDeferred = vi.fn();
    const result = await executeScheduledFollowUpDispatch(
      { run: async <T>(_n: string, fn: () => T | Promise<T>): Promise<T> => fn() },
      {
        failure: {
          auditLedger: { record: vi.fn() },
          operatorAlerter: { alert: vi.fn() },
          inngest: { send: vi.fn() },
        } as never,
        findDueFollowUps: vi.fn().mockResolvedValue([
          {
            id: "fu_1",
            organizationId: "org_1",
            contactId: "contact_1",
            conversationThreadId: "thread_1",
            sessionId: null,
            deploymentId: null,
            workUnitId: null,
            channel: "whatsapp",
            jurisdiction: null,
            templateIntentClass: "re-engagement-offer",
            reason: "went_quiet",
            note: null,
            attempts: 0,
            dueAt: new Date(),
            touchNumber: 1,
            cadenceId: null,
          },
        ]),
        // Route the submit through the REAL handler (no ingress) to prove the gate.
        submitFollowUpSend: async (input) => {
          const r = await handler.execute(
            {
              id: "wu_1",
              organizationId: input.organizationId,
              actor: { id: "system", type: "system" },
              intent: "conversation.followup.send",
              parameters: input,
              deployment: {
                deploymentId: "dep_1",
                skillSlug: "alex",
                trustLevel: "guided",
                trustScore: 0,
              },
              resolvedMode: "workflow",
              traceId: "trace_1",
              trigger: "schedule",
              priority: "normal",
            } as never,
            { submitChildWork: vi.fn() },
          );
          return { ok: true, result: r as never, workUnit: {} as never };
        },
        createFollowUp: vi.fn().mockResolvedValue({ id: "fu_2" }),
        markSent,
        markSkipped,
        markFailed: vi.fn(),
        markDeferred,
      },
    );

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(markSent).not.toHaveBeenCalled();
    // template_not_approved is an activation skip → markDeferred (re-evaluable, not terminal)
    expect(markDeferred).toHaveBeenCalledWith("fu_1", "template_not_approved", expect.any(Date));
    expect(markSkipped).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled(); // never reached the Graph API
  });
});
