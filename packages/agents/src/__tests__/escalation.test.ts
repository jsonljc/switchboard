import { describe, it, expect, vi, beforeEach } from "vitest";
import { EscalationService, type EscalationStore, type EscalationNotifier } from "../escalation.js";

describe("EscalationService", () => {
  let store: EscalationStore;
  let notifier: EscalationNotifier;
  let service: EscalationService;

  beforeEach(() => {
    store = {
      create: vi.fn().mockResolvedValue({ id: "esc-1" }),
      findOpen: vi.fn().mockResolvedValue(null),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    notifier = {
      notifyDashboard: vi.fn().mockResolvedValue(undefined),
      notifyWhatsApp: vi.fn().mockResolvedValue(undefined),
    };
    service = new EscalationService({ store, notifier });
  });

  it("creates durable record before sending notifications", async () => {
    const callOrder: string[] = [];
    (store.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("store");
      return { id: "esc-1" };
    });
    (notifier.notifyDashboard as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push("dashboard");
    });

    await service.escalateToOwner({
      orgId: "org-1",
      contactId: "c-1",
      reason: "low_confidence",
      sourceAgent: "lead-responder",
      priority: "medium",
    });

    expect(callOrder[0]).toBe("store");
    expect(store.create).toHaveBeenCalledOnce();
    expect(notifier.notifyDashboard).toHaveBeenCalledOnce();
  });

  it("does not throw if WhatsApp notification fails", async () => {
    (notifier.notifyWhatsApp as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));

    await expect(
      service.escalateToOwner({
        orgId: "org-1",
        contactId: "c-1",
        reason: "unhappy_lead",
        sourceAgent: "sales-closer",
        priority: "high",
      }),
    ).resolves.not.toThrow();

    expect(store.create).toHaveBeenCalledOnce();
    expect(notifier.notifyDashboard).toHaveBeenCalledOnce();
  });

  it("deduplicates: skips if open escalation exists for same contact+reason", async () => {
    (store.findOpen as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "existing-esc" });

    const result = await service.escalateToOwner({
      orgId: "org-1",
      contactId: "c-1",
      reason: "low_confidence",
      sourceAgent: "lead-responder",
      priority: "medium",
    });

    expect(result.deduplicated).toBe(true);
    expect(store.create).not.toHaveBeenCalled();
  });
});
