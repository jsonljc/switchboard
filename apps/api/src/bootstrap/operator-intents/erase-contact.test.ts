// apps/api/src/bootstrap/operator-intents/erase-contact.test.ts
// Unit tests for the operator.erase_contact handler. Asserts the fail-closed org-scope gate
// (no cascade when the contact is not in the org), the happy path (cascade + completed audit row),
// and the failure path (cascade throws -> failed audit row persisted then re-thrown).
import { describe, it, expect, vi } from "vitest";
import type { WorkUnit } from "@switchboard/core/platform";
import { buildEraseContactHandler, type OperatorContactEraser } from "./erase-contact.js";
import { OPERATOR_INTENT_ERROR_CODES } from "./shared.js";

function makeEraser(existsForOrg = true): {
  findContactForOrg: ReturnType<typeof vi.fn>;
  erase: ReturnType<typeof vi.fn>;
  recordRequest: ReturnType<typeof vi.fn>;
} & OperatorContactEraser {
  return {
    findContactForOrg: vi
      .fn<OperatorContactEraser["findContactForOrg"]>()
      .mockResolvedValue(existsForOrg),
    erase: vi.fn<OperatorContactEraser["erase"]>().mockResolvedValue({ calendarFullyErased: true }),
    recordRequest: vi.fn<OperatorContactEraser["recordRequest"]>().mockResolvedValue(undefined),
  };
}

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: "wu-1",
    requestedAt: new Date().toISOString(),
    organizationId: "org-1",
    actor: { id: "operator-1", type: "user" },
    intent: "operator.erase_contact",
    parameters: { contactId: "contact-1" },
    deployment: { deploymentId: "d-1", skillSlug: "s-1" } as unknown as WorkUnit["deployment"],
    resolvedMode: "operator_mutation",
    traceId: "trace-1",
    trigger: "api",
    priority: "normal",
    ...overrides,
  };
}

describe("buildEraseContactHandler", () => {
  it("erases the contact and writes a completed audit row attributed to the operator", async () => {
    const eraser = makeEraser(true);
    const handler = buildEraseContactHandler(eraser);

    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ contactId: "contact-1", status: "erased" });
    expect(eraser.findContactForOrg).toHaveBeenCalledWith("org-1", "contact-1");
    expect(eraser.erase).toHaveBeenCalledWith("org-1", "contact-1");
    expect(eraser.recordRequest).toHaveBeenCalledWith({
      orgId: "org-1",
      contactId: "contact-1",
      actorId: "operator-1",
      status: "completed",
    });
  });

  it("records a partial audit row when the DB erased but the external calendar lingered", async () => {
    const eraser = makeEraser(true);
    eraser.erase.mockResolvedValue({ calendarFullyErased: false });
    const handler = buildEraseContactHandler(eraser);

    const result = await handler.execute(makeWorkUnit());

    // The governed action completed (the contact IS erased from our DB)...
    expect(result.outcome).toBe("completed");
    expect(result.outputs).toMatchObject({ status: "erased", calendarErasure: "partial" });
    // ...but the durable audit row is honest about the lingering external event.
    expect(eraser.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: "contact-1", status: "partial" }),
    );
    const call = eraser.recordRequest.mock.calls[0]![0] as { failureReason?: string };
    expect(call.failureReason).toMatch(/calendar/i);
  });

  it("fail-closed: a contact not in the org is not erased and returns CONTACT_NOT_FOUND", async () => {
    const eraser = makeEraser(false);
    const handler = buildEraseContactHandler(eraser);

    const result = await handler.execute(makeWorkUnit());

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(OPERATOR_INTENT_ERROR_CODES.CONTACT_NOT_FOUND);
    expect(eraser.erase).not.toHaveBeenCalled();
    expect(eraser.recordRequest).not.toHaveBeenCalled();
  });

  it("persists a failed audit row then re-throws when the cascade throws", async () => {
    const eraser = makeEraser(true);
    eraser.erase.mockRejectedValueOnce(new Error("cascade boom"));
    const handler = buildEraseContactHandler(eraser);

    await expect(handler.execute(makeWorkUnit())).rejects.toThrow("cascade boom");

    expect(eraser.recordRequest).toHaveBeenCalledWith({
      orgId: "org-1",
      contactId: "contact-1",
      actorId: "operator-1",
      status: "failed",
      failureReason: "cascade boom",
    });
  });

  it("uses the authenticated actor id from the work unit, not a parameter", async () => {
    const eraser = makeEraser(true);
    const handler = buildEraseContactHandler(eraser);

    await handler.execute(
      makeWorkUnit({
        actor: { id: "real-operator", type: "user" },
        parameters: { contactId: "contact-9", actorId: "spoofed" },
      }),
    );

    expect(eraser.recordRequest).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "real-operator", contactId: "contact-9" }),
    );
  });
});
