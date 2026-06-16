import { describe, it, expect } from "vitest";
import { createResendEmailSender } from "./send-email.js";

describe("createResendEmailSender", () => {
  it("returns ok:false reason 'not_configured' when no apiKey is set (never throws, never imports)", async () => {
    const sender = createResendEmailSender({ from: "noreply@switchboard.app" });

    const result = await sender({
      to: ["owner@clinic.test"],
      subject: "Your week",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
  });

  it("treats an empty-string apiKey as not configured", async () => {
    const sender = createResendEmailSender({ apiKey: "", from: "noreply@switchboard.app" });

    const result = await sender({
      to: ["owner@clinic.test"],
      subject: "Your week",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
  });
});
