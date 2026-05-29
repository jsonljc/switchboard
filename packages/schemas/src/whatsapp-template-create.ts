import { z } from "zod";

const E164 = /^\+[1-9]\d{6,14}$/;

/** Count distinct `{{n}}` placeholders in a string. */
function countVariables(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  return new Set(matches.map((m) => m.replace(/\D/g, ""))).size;
}

/** TEXT-only; media headers (IMAGE/VIDEO/DOCUMENT) are out of scope. */
const HeaderSchema = z.object({ text: z.string().min(1).max(60) });
const BodySchema = z.object({
  text: z.string().min(1).max(1024),
  examples: z.array(z.string().min(1)).optional(),
});
const FooterSchema = z.object({ text: z.string().min(1).max(60) });

const ButtonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().min(1).max(25) }),
  z.object({
    type: z.literal("URL"),
    text: z.string().min(1).max(25),
    url: z
      .string()
      .url()
      .regex(/^https?:\/\//i, "url must start with http:// or https://"),
  }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().min(1).max(25),
    phoneNumber: z.string().regex(E164, "phoneNumber must be E.164 (e.g. +15551234567)"),
  }),
]);

export const WhatsAppCreateTemplateRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, "name must be lowercase letters, digits, and underscores only"),
    language: z
      .string()
      .min(2)
      .max(16)
      .regex(/^[a-zA-Z_-]+$/, "language must be ISO-like, e.g. en_US"),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    header: HeaderSchema.optional(),
    body: BodySchema,
    footer: FooterSchema.optional(),
    buttons: z.array(ButtonSchema).max(10, "at most 10 buttons allowed").optional(),
  })
  .superRefine((val, ctx) => {
    if (val.header && countVariables(val.header.text) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["header", "text"],
        message: "header may contain at most one {{1}} variable",
      });
    }
    if (val.footer && countVariables(val.footer.text) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["footer", "text"],
        message: "footer must not contain variables",
      });
    }
    const bodyIndices = [
      ...new Set(
        (val.body.text.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((m) =>
          parseInt(m.replace(/\D/g, ""), 10),
        ),
      ),
    ].sort((a, b) => a - b);
    const bodyVars = bodyIndices.length;
    if (bodyVars > 0 && (bodyIndices[0] !== 1 || bodyIndices.some((v, i) => v !== i + 1))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body", "text"],
        message: "body variables must be sequential starting at {{1}} (e.g. {{1}}, {{2}})",
      });
    }
    const sampleCount = val.body.examples?.length ?? 0;
    if (bodyVars !== sampleCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body", "examples"],
        message: `body has ${bodyVars} variable(s) but ${sampleCount} example(s); each {{n}} needs exactly one sample`,
      });
    }
    if (val.buttons) {
      const urls = val.buttons.filter((b) => b.type === "URL").length;
      const phones = val.buttons.filter((b) => b.type === "PHONE_NUMBER").length;
      if (urls > 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["buttons"],
          message: "at most 2 URL buttons allowed",
        });
      }
      if (phones > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["buttons"],
          message: "at most 1 PHONE_NUMBER button allowed",
        });
      }
    }
  });

export type WhatsAppCreateTemplateRequest = z.infer<typeof WhatsAppCreateTemplateRequestSchema>;
