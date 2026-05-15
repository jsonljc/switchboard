import { z } from "zod";

export const ActivityKindSchema = z.enum([
  "booked",
  "qualified",
  "replied",
  "sent",
  "started",
  "connected",
  "waiting",
  "escalated",
  "passed",
  "watching",
  "reviewing",
  "paused",
  "scaled",
  "rotated",
  "shifted",
  "restructured",
  "alert",
]);

export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const ThreadMessageSchema = z.object({
  from: z.enum(["contact", "alex", "operator"]),
  text: z.string().min(1),
});

export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export const ActivityRowSchema = z.object({
  id: z.string().optional(),
  time: z.string().min(1),
  kind: ActivityKindSchema,
  head: z.string().min(1),
  body: z.string().optional(),
  who: z.string().optional(),
  contactId: z.string().optional(),
  preview: z.array(ThreadMessageSchema).optional(),
  replyable: z.boolean().optional(),
  tag: z.string().optional(),
  timestampIso: z.string().optional(),
});

export type ActivityRow = z.infer<typeof ActivityRowSchema>;
