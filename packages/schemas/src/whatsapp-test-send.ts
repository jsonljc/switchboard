import { z } from "zod";

const E164 = /^\+[1-9]\d{6,14}$/;

export const WhatsAppSendTestRequestSchema = z.object({
  phoneNumberId: z.string().min(1),
  templateName: z.string().min(1).max(512),
  languageCode: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[a-zA-Z_-]+$/, "languageCode must be ISO-like, e.g. en_US"),
  toNumber: z.string().regex(E164, "toNumber must be E.164 (e.g. +15551234567)"),
});

export const WhatsAppSendTestGraphErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

// apiStatus is terminal: "sent" means Graph returned a messageId; "failed" means it didn't.
// Slice 2A note: the live POST /send-test handler emits the "sent" branch on success and
// the standard `{ error: { code, message, retryable } }` envelope on failure — it does not
// return or persist the "failed" branch of this schema today. The branch is reserved for a
// future iteration (likely Slice 2B+) that surfaces failed attempts in the UI. Do not
// consume `status: "failed"` from /send-test responses without first verifying the handler
// has been updated.
export const WhatsAppSendTestResultSchema = z.object({
  messageId: z.string().nullable(),
  status: z.enum(["sent", "failed"]),
  sentAt: z.string(),
  graphError: WhatsAppSendTestGraphErrorSchema.optional(),
});

export const WhatsAppTestSendRowSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  phoneNumberId: z.string(),
  templateName: z.string(),
  languageCode: z.string(),
  toNumber: z.string(),
  sentBy: z.string(),
  sentAt: z.string(),
  apiStatus: z.enum(["sent", "failed"]),
  lastWebhookStatus: z.enum(["sent", "delivered", "read", "failed"]).nullable(),
  lastWebhookAt: z.string().nullable(),
});

export type WhatsAppSendTestRequest = z.infer<typeof WhatsAppSendTestRequestSchema>;
export type WhatsAppSendTestResult = z.infer<typeof WhatsAppSendTestResultSchema>;
export type WhatsAppTestSendRow = z.infer<typeof WhatsAppTestSendRowSchema>;
