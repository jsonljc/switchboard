import { z } from "zod";

export const ActionType = z.enum([
  "send_message",
  "browse_url",
  "read_file",
  "write_file",
  "api_call",
]);
export type ActionType = z.infer<typeof ActionType>;

export const ActionStatus = z.enum(["pending", "approved", "rejected", "executed", "blocked"]);
export type ActionStatus = z.infer<typeof ActionStatus>;

export const ActionRequestSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  type: ActionType,
  surface: z.string(),
  payload: z.record(z.unknown()),
  status: ActionStatus.default("pending"),
  governanceResult: z.record(z.unknown()).nullable().optional(),
  reviewedBy: z.string().nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
  executedAt: z.coerce.date().nullable().optional(),
  createdAt: z.coerce.date(),
});

export type ActionRequest = z.infer<typeof ActionRequestSchema>;
