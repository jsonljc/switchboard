import type {
  ScheduledTrigger,
  TriggerFilters,
  TriggerType,
  TriggerAction,
  EventPattern,
} from "@switchboard/schemas";
import type { TriggerStore } from "./trigger-store.js";
import { validateTriggerTransition, filterMatchingTriggers } from "./trigger-types.js";
import { randomUUID } from "node:crypto";

export interface RegisterTriggerInput {
  organizationId: string;
  type: TriggerType;
  fireAt: Date | null;
  cronExpression: string | null;
  eventPattern: EventPattern | null;
  action: TriggerAction;
  sourceWorkflowId: string | null;
  expiresAt: Date | null;
}

export interface SchedulerService {
  registerTrigger(input: RegisterTriggerInput): Promise<string>;
  cancelTrigger(triggerId: string): Promise<void>;
  listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]>;
  matchEvent(
    organizationId: string,
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<ScheduledTrigger[]>;
}

export interface SchedulerServiceDeps {
  store: TriggerStore;
}

export function createSchedulerService(deps: SchedulerServiceDeps): SchedulerService {
  const { store } = deps;

  return {
    async registerTrigger(input: RegisterTriggerInput): Promise<string> {
      const id = randomUUID();
      const trigger: ScheduledTrigger = {
        id,
        organizationId: input.organizationId,
        type: input.type,
        fireAt: input.fireAt,
        cronExpression: input.cronExpression,
        eventPattern: input.eventPattern,
        action: input.action,
        sourceWorkflowId: input.sourceWorkflowId,
        status: "active",
        createdAt: new Date(),
        expiresAt: input.expiresAt,
      };
      await store.save(trigger);
      return id;
    },

    async cancelTrigger(triggerId: string): Promise<void> {
      const trigger = await store.findById(triggerId);
      if (!trigger) {
        throw new Error(`Trigger not found: ${triggerId}`);
      }
      validateTriggerTransition(trigger.status, "cancelled");
      await store.updateStatus(triggerId, "cancelled");
    },

    async listPendingTriggers(filters: TriggerFilters): Promise<ScheduledTrigger[]> {
      return store.findByFilters(filters);
    },

    async matchEvent(
      organizationId: string,
      eventType: string,
      eventData: Record<string, unknown>,
    ): Promise<ScheduledTrigger[]> {
      const candidates = await store.findByFilters({
        organizationId,
        status: "active",
        type: "event_match",
      });

      return filterMatchingTriggers(candidates, eventType, eventData);
    },
  };
}
