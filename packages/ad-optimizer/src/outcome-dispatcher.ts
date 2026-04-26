import type { ActionSource } from "@switchboard/schemas";

export type OutcomeKind = "qualified" | "booked" | "showed" | "paid";

export interface OutcomeEvent {
  contactId: string;
  kind: OutcomeKind;
  value?: number;
  currency?: string;
}

interface ContactRecord {
  id: string;
  organizationId: string;
  sourceType: string | null;
  attribution: Record<string, unknown> | null;
}

export interface ContactReader {
  getContact(id: string): Promise<ContactRecord | null>;
}

export interface CapiLike {
  dispatch(event: {
    eventName: string;
    actionSource: ActionSource;
    attribution: Record<string, unknown>;
    value?: number;
    currency?: string;
  }): Promise<{ ok: boolean }>;
}

const KIND_TO_EVENT: Record<OutcomeKind, string> = {
  qualified: "Lead",
  booked: "Schedule",
  showed: "Schedule",
  paid: "Purchase",
};

const SOURCE_TO_ACTION_SOURCE: Record<string, ActionSource> = {
  ctwa: "business_messaging",
  instant_form: "system_generated",
};

export class OutcomeDispatcher {
  constructor(private readonly deps: { capi: CapiLike; store: ContactReader }) {}

  async handle(event: OutcomeEvent): Promise<void> {
    const contact = await this.deps.store.getContact(event.contactId);
    if (!contact || !contact.sourceType) {
      console.warn(
        `OutcomeDispatcher: skipping ${event.kind} for ${event.contactId}: no sourceType`,
      );
      return;
    }
    const actionSource = SOURCE_TO_ACTION_SOURCE[contact.sourceType];
    if (!actionSource) {
      console.warn(
        `OutcomeDispatcher: skipping ${event.kind} for ${event.contactId}: source ${contact.sourceType} not v1`,
      );
      return;
    }
    await this.deps.capi.dispatch({
      eventName: KIND_TO_EVENT[event.kind],
      actionSource,
      attribution: contact.attribution ?? {},
      value: event.value,
      currency: event.currency,
    });
  }
}
