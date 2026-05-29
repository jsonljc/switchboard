import { describe, it, expect } from "vitest";
import { WhatsAppCreateTemplateRequestSchema } from "../whatsapp-template-create.js";

const base = {
  name: "order_update",
  language: "en_US",
  category: "MARKETING" as const,
  body: { text: "Hello, your order is on its way." },
};

describe("WhatsAppCreateTemplateRequestSchema", () => {
  it("accepts a minimal BODY-only template", () => {
    expect(WhatsAppCreateTemplateRequestSchema.parse(base)).toMatchObject(base);
  });

  it("rejects an uppercase / spaced name", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({ ...base, name: "Order Update" }),
    ).toThrow();
  });

  it("accepts body variables with matching examples", () => {
    expect(
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        body: { text: "Hi {{1}}, your code is {{2}}.", examples: ["Ada", "1234"] },
      }),
    ).toBeTruthy();
  });

  it("rejects body variables with the wrong number of examples", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        body: { text: "Hi {{1}}, your code is {{2}}.", examples: ["Ada"] },
      }),
    ).toThrow();
  });

  it("rejects non-sequential body variables", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        body: { text: "Hi {{1}}, ref {{3}}.", examples: ["Ada", "X"] },
      }),
    ).toThrow();
  });

  it("rejects body variables when examples is omitted", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        body: { text: "Hi {{1}}, your code is {{2}}." },
      }),
    ).toThrow();
  });

  it("rejects a footer containing a variable", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({ ...base, footer: { text: "Ref {{1}}" } }),
    ).toThrow();
  });

  it("rejects a header with more than one variable", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({ ...base, header: { text: "{{1}} {{2}}" } }),
    ).toThrow();
  });

  it("accepts QUICK_REPLY / URL / PHONE_NUMBER buttons", () => {
    expect(
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [
          { type: "QUICK_REPLY", text: "Stop" },
          { type: "URL", text: "Track", url: "https://example.com/track" },
          { type: "PHONE_NUMBER", text: "Call", phoneNumber: "+15551234567" },
        ],
      }),
    ).toBeTruthy();
  });

  it("rejects more than 2 URL buttons", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [
          { type: "URL", text: "A", url: "https://a.com" },
          { type: "URL", text: "B", url: "https://b.com" },
          { type: "URL", text: "C", url: "https://c.com" },
        ],
      }),
    ).toThrow();
  });

  it("rejects more than 1 PHONE_NUMBER button", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [
          { type: "PHONE_NUMBER", text: "A", phoneNumber: "+15551112222" },
          { type: "PHONE_NUMBER", text: "B", phoneNumber: "+15553334444" },
        ],
      }),
    ).toThrow();
  });

  it("rejects an invalid URL and a non-E.164 phone", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [{ type: "URL", text: "X", url: "not-a-url" }],
      }),
    ).toThrow();
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [{ type: "PHONE_NUMBER", text: "X", phoneNumber: "5551234567" }],
      }),
    ).toThrow();
  });

  it("rejects a non-http(s) URL button", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        name: "order_update",
        language: "en_US",
        category: "MARKETING",
        body: { text: "Hello." },
        buttons: [{ type: "URL", text: "X", url: "ftp://example.com/file" }],
      }),
    ).toThrow();
  });
});
