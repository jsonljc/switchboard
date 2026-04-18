import type { ConversionEvent } from "../events/conversion-bus.js";

interface OpportunityStoreSubset {
  updateStage(
    orgId: string,
    opportunityId: string,
    stage: string,
    closedAt?: Date | null,
  ): Promise<unknown>;
}

interface ActivityStoreSubset {
  write(input: {
    organizationId: string;
    deploymentId: string;
    eventType: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export class CrmUpdaterConsumer {
  constructor(
    private opportunityStore: OpportunityStoreSubset,
    private activityStore: ActivityStoreSubset,
  ) {}

  async handle(event: ConversionEvent): Promise<void> {
    const opportunityId = event.metadata?.["opportunityId"] as string | undefined;
    if (!opportunityId) return;

    await this.opportunityStore.updateStage(
      event.organizationId,
      opportunityId,
      event.type,
      undefined,
    );

    await this.activityStore.write({
      organizationId: event.organizationId,
      deploymentId: (event.metadata?.["deploymentId"] as string) ?? "system",
      eventType: "stage-update",
      description: `Stage updated to ${event.type} via conversion event`,
      metadata: { eventId: event.eventId, contactId: event.contactId },
    });
  }
}
