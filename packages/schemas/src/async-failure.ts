import { z } from "zod";

/**
 * The shared shape for every async (Inngest) function failure on retry-exhaustion.
 * Shares the { code, message, stage? } core with core's ExecutionError (the
 * Route Governance Contract §13 seam); adds async-specific metadata.
 */
export const AsyncFailureEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  stage: z.string().optional(),
  functionId: z.string(),
  eventName: z.string(),
  runId: z.string().optional(),
  attempts: z.number().int(),
  retryable: z.boolean(),
  organizationId: z.string().optional(),
  deploymentId: z.string().optional(),
  occurredAt: z.string().datetime(),
});

export type AsyncFailureEnvelope = z.infer<typeof AsyncFailureEnvelopeSchema>;
