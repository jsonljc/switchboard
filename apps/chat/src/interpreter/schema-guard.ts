import { z } from "zod";
import { ActionProposalSchema } from "@switchboard/schemas";

const ReadIntentSchema = z
  .object({
    intent: z.string(),
    slots: z.record(z.string(), z.unknown()),
    confidence: z.number().min(0).max(1),
  })
  .nullable()
  .optional();

const InterpreterOutputSchema = z.object({
  proposals: z.array(ActionProposalSchema),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  readIntent: ReadIntentSchema,
});

export function guardInterpreterOutput(raw: unknown): {
  valid: boolean;
  data: z.infer<typeof InterpreterOutputSchema> | null;
  errors: string[];
} {
  const result = InterpreterOutputSchema.safeParse(raw);

  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }

  const errors = result.error.errors.map(
    (e) => `${e.path.join(".")}: ${e.message}`,
  );

  return { valid: false, data: null, errors };
}
