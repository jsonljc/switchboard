import { describe, it, expect, vi } from "vitest";
import { buildWebsiteLeadIntakeWorkflow } from "../website-lead-intake-workflow.js";

const ORG = "org_1";

function makeServices(
  submitChildWork = vi.fn(async () => ({ ok: true, workUnit: { id: "child_1" } })),
) {
  return {
    submitChildWork,
  } as unknown as import("@switchboard/core/platform").WorkflowRuntimeServices;
}

describe("website.lead.intake workflow", () => {
  it("creates a contact, submits the greeting child work, and returns completed", async () => {
    const findExistingContact = vi.fn(async () => null);
    const createContact = vi.fn(async () => ({ id: "contact_1" }));
    const wf = buildWebsiteLeadIntakeWorkflow({
      prisma: {} as never,
      findExistingContact,
      createContact,
    });
    const submitChildWork = vi.fn(async () => ({ ok: true, workUnit: { id: "child_1" } }));

    const result = await wf.execute(
      {
        id: "wu_1",
        organizationId: ORG,
        actor: { id: "system", type: "service" },
        parameters: {
          name: "Sarah",
          phone: "+6591234567",
          email: "s@e.com",
          message: "interested",
          source: "website",
          sourceDetail: "tally:form_xyz",
          metadata: { page: "https://b.com/x", utmSource: "google", fbclid: "abc", extra: {} },
          greetingTemplateName: "lead_welcome",
        },
      } as never,
      makeServices(submitChildWork),
    );

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        name: "Sarah",
        phone: "+6591234567",
        email: "s@e.com",
        primaryChannel: "whatsapp",
        source: "website",
        attribution: expect.objectContaining({
          sourceDetail: "tally:form_xyz",
          fbclid: "abc",
          utmSource: "google",
        }),
      }),
    );
    expect(submitChildWork).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "meta.lead.greeting.send",
        organizationId: ORG,
        parentWorkUnitId: "wu_1",
        parameters: expect.objectContaining({
          phone: "+6591234567",
          firstName: "Sarah",
          templateName: "lead_welcome",
        }),
      }),
    );
    expect(result.outcome).toBe("completed");
  });

  it("reuses existing contact instead of creating a duplicate", async () => {
    const findExistingContact = vi.fn(async () => ({ id: "existing", attribution: {} }));
    const createContact = vi.fn(async () => ({ id: "should_not_be_called" }));
    const wf = buildWebsiteLeadIntakeWorkflow({
      prisma: {} as never,
      findExistingContact,
      createContact,
    });

    const result = await wf.execute(
      {
        id: "wu_2",
        organizationId: ORG,
        actor: { id: "system", type: "service" },
        parameters: {
          phone: "+6591234567",
          source: "website",
          sourceDetail: "tally:form_xyz",
          metadata: { extra: {} },
          greetingTemplateName: "lead_welcome",
        },
      } as never,
      makeServices(),
    );

    expect(createContact).not.toHaveBeenCalled();
    expect(result.outcome).toBe("completed");
  });

  it("returns failed when neither phone nor email present", async () => {
    const wf = buildWebsiteLeadIntakeWorkflow({
      prisma: {} as never,
      findExistingContact: vi.fn(async () => null),
      createContact: vi.fn(async () => ({ id: "x" })),
    });
    const result = await wf.execute(
      {
        id: "wu_3",
        organizationId: ORG,
        actor: { id: "system", type: "service" },
        parameters: {
          source: "website",
          metadata: { extra: {} },
          greetingTemplateName: "lead_welcome",
        },
      } as never,
      makeServices(),
    );
    expect(result.outcome).toBe("failed");
  });

  it("creates email-only contact without sending greeting", async () => {
    const findExistingContact = vi.fn(async () => null);
    const createContact = vi.fn(async () => ({ id: "contact_email" }));
    const submitChildWork = vi.fn(async () => ({ ok: true, workUnit: { id: "child_x" } }));
    const wf = buildWebsiteLeadIntakeWorkflow({
      prisma: {} as never,
      findExistingContact,
      createContact,
    });

    const result = await wf.execute(
      {
        id: "wu_4",
        organizationId: ORG,
        actor: { id: "system", type: "service" },
        parameters: {
          email: "only@e.com",
          source: "website",
          metadata: { extra: {} },
          greetingTemplateName: "lead_welcome",
        },
      } as never,
      makeServices(submitChildWork),
    );

    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({ phone: null, email: "only@e.com", primaryChannel: "email" }),
    );
    expect(submitChildWork).not.toHaveBeenCalled();
    expect(result.outcome).toBe("completed");
  });
});
