import type { WorkflowHandler } from "../platform/modes/workflow-mode.js";
import { LeadIntakeSchema, type LeadIntake } from "@switchboard/schemas";
import { LeadIntakeHandler } from "./lead-intake-handler.js";

/**
 * Wraps {@link LeadIntakeHandler} as a `workflow`-mode {@link WorkflowHandler} so that
 * `lead.intake` flows through the existing `PlatformIngress.submit()` front door
 * (route -> ingress -> governance -> mode dispatch -> handler).
 *
 * Intent registration + concrete store wiring happens in `apps/api` bootstrap
 * (alongside the prisma client), not here. See Task 11.
 */
export function buildLeadIntakeWorkflow(handler: LeadIntakeHandler): WorkflowHandler {
  return {
    async execute(workUnit) {
      const parsed = LeadIntakeSchema.safeParse(workUnit.parameters);
      if (!parsed.success) {
        return {
          outcome: "failed",
          summary: "Invalid lead.intake payload",
          outputs: {},
          error: { code: "INVALID_PAYLOAD", message: parsed.error.message },
        };
      }
      const intake: LeadIntake = parsed.data;
      const result = await handler.handle(intake);
      return {
        outcome: "completed",
        summary: result.duplicate
          ? `Duplicate lead — contact ${result.contactId}`
          : `Lead intake recorded — contact ${result.contactId}`,
        outputs: { contactId: result.contactId, duplicate: result.duplicate },
      };
    },
  };
}
