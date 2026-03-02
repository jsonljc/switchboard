import { z } from "zod";

export const DomainEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  sourceCartridgeId: z.string(),
  organizationId: z.string(),
  principalId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  envelopeId: z.string(),
  traceId: z.string(),
  emittedAt: z.coerce.date(),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

export const EventReactionTargetActionSchema = z.object({
  cartridgeId: z.string(),
  actionType: z.string(),
  parameterTemplate: z.record(z.string(), z.unknown()),
});

export const EventReactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  eventTypePattern: z.string(),
  organizationId: z.string(),
  targetAction: EventReactionTargetActionSchema,
  condition: z.record(z.string(), z.unknown()).nullable(),
  enabled: z.boolean(),
  priority: z.number().int(),
  actorId: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type EventReaction = z.infer<typeof EventReactionSchema>;
