import { describe, it, expect, vi, afterEach } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

const adapter = new WhatsAppAdapter({
  token: "test_token",
  phoneNumberId: "123456789",
  appSecret: "test_secret",
});

describe("WhatsAppAdapter — Flows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("sendFlowMessage", () => {
    it("should send a Flow interactive message", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages: [{ id: "wamid.flow1" }] }), { status: 200 }),
        );

      await adapter.sendFlowMessage("15551234567", {
        flowId: "flow_123",
        flowToken: "token_abc",
        ctaText: "Book Now",
        bodyText: "Ready to book?",
        screen: "SERVICE_SELECTION",
        data: { org: "acme" },
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.type).toBe("interactive");
      expect(body.interactive.type).toBe("flow");
      expect(body.interactive.action.name).toBe("flow");
      expect(body.interactive.action.parameters.flow_id).toBe("flow_123");
      expect(body.interactive.action.parameters.flow_cta).toBe("Book Now");
      expect(body.interactive.action.parameters.flow_action).toBe("navigate");
      expect(body.interactive.action.parameters.flow_action_payload.screen).toBe(
        "SERVICE_SELECTION",
      );
    });
  });

  describe("parseIncomingMessage — nfm_reply", () => {
    it("should parse Flow completion as incoming message", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Flow User" }, wa_id: "15551234567" }],
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.flow_complete",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "nfm_reply",
                        nfm_reply: {
                          response_json: JSON.stringify({
                            service: "haircut",
                            date: "2026-05-01",
                            time: "14:00",
                          }),
                          body: "Sent",
                          name: "flow",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const msg = adapter.parseIncomingMessage(payload);
      expect(msg).not.toBeNull();
      expect(msg!.metadata?.["interactiveType"]).toBe("nfm_reply");
      expect(msg!.metadata?.["flowResponse"]).toEqual({
        service: "haircut",
        date: "2026-05-01",
        time: "14:00",
      });
      expect(msg!.text).toBe(
        JSON.stringify({
          service: "haircut",
          date: "2026-05-01",
          time: "14:00",
        }),
      );
    });

    // CHAN-10: a malformed flow response_json was silently swallowed by an empty
    // catch. It must not crash the webhook, and the drop must be observable.
    it("does not throw and surfaces a warning on malformed response_json", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                value: {
                  contacts: [{ profile: { name: "Flow User" }, wa_id: "15551234567" }],
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.flow_bad",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "nfm_reply",
                        nfm_reply: { response_json: "{not valid json", body: "Sent", name: "flow" },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      let msg: ReturnType<typeof adapter.parseIncomingMessage>;
      expect(() => {
        msg = adapter.parseIncomingMessage(payload);
      }).not.toThrow();
      // Malformed flow payload falls through to the no-text path -> null.
      expect(msg!).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
