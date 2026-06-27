import { describe, it, expect, vi } from "vitest";
import { LeadIntakeHandler } from "./lead-intake-handler.js";
import {
  canSendWhatsAppTemplate,
  isWithinWhatsAppWindow,
} from "../notifications/whatsapp-window.js";
import type { LeadIntake } from "@switchboard/schemas";

/**
 * EV-9a / GOV-6 — pins the CTWA consent boundary as a SEAM by composing the REAL
 * `LeadIntakeHandler` output with the REAL `canSendWhatsAppTemplate` window gate.
 *
 * `messagingOptIn` is the platform 24h-window opt-in, NOT marketing consent. A click-to-
 * WhatsApp (CTWA) ad-click OPENS the 24h free-entry window (greetable in-window) but is NOT
 * a durable opt-in: `LeadIntakeHandler` writes neither `messagingOptIn` nor
 * `messagingOptInSource` for a CTWA lead, so the contact persists at the DB default
 * `messagingOptIn=false`. The leg mechanics are also pinned individually in
 * `lead-intake-handler.test.ts` and `whatsapp-window.test.ts`; this file pins the COMPOSED
 * consent boundary (handler output → window gate), which neither does.
 */

const makeStore = () => ({
  upsertContact: vi.fn().mockResolvedValue({ id: "contact_1" }),
  createActivity: vi.fn().mockResolvedValue({ id: "act_1" }),
  findContactByIdempotency: vi.fn().mockResolvedValue(null),
  findByPhoneOrEmail: vi.fn().mockResolvedValue([]),
});

const makeIntake = (overrides: Partial<LeadIntake> = {}): LeadIntake => ({
  source: "ctwa",
  organizationId: "o1",
  deploymentId: "d1",
  contact: { phone: "+6591234567", channel: "whatsapp" },
  attribution: {
    ctwa_clid: "abc",
    sourceCampaignId: "c1",
    capturedAt: "2026-04-26T00:00:00Z",
  },
  idempotencyKey: "+6591234567:abc",
  ...overrides,
});

describe("CTWA consent <-> WhatsApp-window seam (EV-9a / GOV-6)", () => {
  it("(1) a CTWA inside-window allow writes NO durable messagingOptIn", async () => {
    const store = makeStore();
    await new LeadIntakeHandler({ store }).handle(
      makeIntake({ source: "ctwa", contact: { phone: "+6591234567", channel: "whatsapp" } }),
    );

    const upserted = store.upsertContact.mock.calls[0]?.[0] as Record<string, unknown>;
    // Nothing durable is stamped — the ad-click is not a permanent opt-in.
    expect(upserted.messagingOptIn).toBeUndefined();
    expect(upserted.messagingOptInSource).toBeUndefined();

    // Yet the persisted posture (messagingOptIn=false) is STILL greetable inside the window:
    // the inbound that opened the window — not a stored opt-in — authorizes the in-window send.
    const persistedOptIn = upserted.messagingOptIn === true; // false
    expect(isWithinWhatsAppWindow(new Date())).toBe(true);
    expect(
      canSendWhatsAppTemplate({
        contact: { messagingOptIn: persistedOptIn },
        lastInboundAt: new Date(),
      }),
    ).toEqual({ allowed: true });
  });

  it("(2) messagingOptInSource:'ctwa' ALONE fails the OUTSIDE-window gate (ctwa source never sets messagingOptIn=true)", async () => {
    const store = makeStore();
    await new LeadIntakeHandler({ store }).handle(
      makeIntake({ source: "ctwa", contact: { phone: "+6591234567", channel: "whatsapp" } }),
    );
    const upserted = store.upsertContact.mock.calls[0]?.[0] as Record<string, unknown>;

    // The only opt-in signal a CTWA lead carries is its SOURCE; the handler never promotes that to
    // a durable messagingOptIn=true (asserted in branch 1). canSendWhatsAppTemplate keys on the
    // boolean, so a CTWA-sourced contact is { messagingOptIn:false } and OUTSIDE the window blocks.
    const ctwaContact = {
      messagingOptIn: upserted.messagingOptIn === true, // false
      messagingOptInSource: "ctwa" as const,
    };
    expect(ctwaContact.messagingOptIn).toBe(false);

    // null inbound (never opened a window) → outside → blocked
    expect(isWithinWhatsAppWindow(null)).toBe(false);
    expect(
      canSendWhatsAppTemplate({
        contact: { messagingOptIn: ctwaContact.messagingOptIn },
        lastInboundAt: null,
      }),
    ).toEqual({ allowed: false, reason: "outside_window_no_consent" });

    // aged inbound (>24h) → window expired → blocked
    const aged = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(
      canSendWhatsAppTemplate({
        contact: { messagingOptIn: ctwaContact.messagingOptIn },
        lastInboundAt: aged,
      }),
    ).toEqual({ allowed: false, reason: "outside_window_no_consent" });

    // Contrast: a genuine DURABLE opt-in (Instant Form → web_form) DOES send outside the window,
    // which proves the block above is the ctwa-source distinction, not a blanket outside-window deny.
    const formStore = makeStore();
    await new LeadIntakeHandler({ store: formStore }).handle(
      makeIntake({
        source: "instant_form",
        contact: { phone: "+6591234567", channel: "whatsapp" },
      }),
    );
    const formUpsert = formStore.upsertContact.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(formUpsert.messagingOptIn).toBe(true);
    expect(formUpsert.messagingOptInSource).toBe("web_form");
    expect(
      canSendWhatsAppTemplate({
        contact: { messagingOptIn: formUpsert.messagingOptIn === true },
        lastInboundAt: aged,
      }),
    ).toEqual({ allowed: true });
  });

  it("(3) a returning CTWA lead is NOT re-greeted: redelivery → idempotent_duplicate, identity match → reused (never 'created')", async () => {
    // The Meta-lead orchestrator greets ONLY on outcome==="created" (LeadIntakeResult contract);
    // "idempotent_duplicate" and "reused" both suppress the first-touch greeting so one corroborated
    // person is greeted exactly once.

    // (a) same idempotencyKey redelivered → idempotent_duplicate, no upsert, no re-greet
    const dupStore = makeStore();
    dupStore.findContactByIdempotency.mockResolvedValueOnce({ id: "existing" });
    const dup = await new LeadIntakeHandler({ store: dupStore }).handle(
      makeIntake({ source: "ctwa" }),
    );
    expect(dup.outcome).toBe("idempotent_duplicate");
    expect(dup.outcome).not.toBe("created");
    expect(dupStore.upsertContact).not.toHaveBeenCalled();

    // (b) same person, a second CTWA touch → A4 identity match → reuse, no new contact, no re-greet
    const reuseStore = makeStore();
    reuseStore.findByPhoneOrEmail.mockResolvedValueOnce([
      { id: "existing", name: "Jane Tan", phoneE164: "+6591234567", email: null },
    ]);
    const reuse = await new LeadIntakeHandler({ store: reuseStore }).handle(
      makeIntake({
        source: "ctwa",
        contact: { phone: "91234567", name: "jane tan", channel: "whatsapp" },
      }),
    );
    expect(reuse.outcome).toBe("reused");
    expect(reuse.outcome).not.toBe("created");
    expect(reuseStore.upsertContact).not.toHaveBeenCalled();
  });
});
