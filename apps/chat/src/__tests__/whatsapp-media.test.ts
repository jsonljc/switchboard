import { describe, it, expect, vi, afterEach } from "vitest";
import { WhatsAppAdapter } from "../adapters/whatsapp.js";

const adapter = new WhatsAppAdapter({
  token: "test_token",
  phoneNumberId: "123456789",
  appSecret: "test_secret",
});

function buildMediaPayload(type: string, mediaId: string, extras?: Record<string, unknown>) {
  const mediaObj: Record<string, unknown> = { id: mediaId, ...extras };
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Media User" }, wa_id: "15551234567" }],
              messages: [
                {
                  from: "15551234567",
                  id: "wamid.media1",
                  timestamp: "1700000000",
                  type,
                  [type]: mediaObj,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsAppAdapter — media receiving", () => {
  it("should parse image message with attachment metadata", () => {
    const payload = buildMediaPayload("image", "img_123");
    const msg = adapter.parseIncomingMessage(payload);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("");
    expect(msg!.metadata?.["originalType"]).toBe("image");
    expect(msg!.metadata?.["mediaId"]).toBe("img_123");
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]).toMatchObject({
      type: "image",
      url: null,
      data: { mediaId: "img_123" },
    });
  });

  it("should parse document message with filename", () => {
    const payload = buildMediaPayload("document", "doc_456", { filename: "receipt.pdf" });
    const msg = adapter.parseIncomingMessage(payload);
    expect(msg).not.toBeNull();
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]).toMatchObject({
      type: "document",
      filename: "receipt.pdf",
      data: { mediaId: "doc_456" },
    });
  });

  it("should parse video message", () => {
    const payload = buildMediaPayload("video", "vid_789");
    const msg = adapter.parseIncomingMessage(payload);
    expect(msg).not.toBeNull();
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]!.type).toBe("video");
  });

  it("should parse audio message", () => {
    const payload = buildMediaPayload("audio", "aud_012");
    const msg = adapter.parseIncomingMessage(payload);
    expect(msg).not.toBeNull();
    expect(msg!.attachments).toHaveLength(1);
    expect(msg!.attachments[0]!.type).toBe("audio");
  });
});

describe("WhatsAppAdapter — media sending", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send image by URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.sent1" }] }), { status: 200 }),
      );

    await adapter.sendMedia(
      "15551234567",
      "image",
      { url: "https://example.com/photo.jpg" },
      "Check this out",
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "15551234567",
      type: "image",
      image: { link: "https://example.com/photo.jpg", caption: "Check this out" },
    });
  });

  it("should send document by URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: "wamid.sent2" }] }), { status: 200 }),
      );

    await adapter.sendMedia(
      "15551234567",
      "document",
      { url: "https://example.com/receipt.pdf" },
      "Your receipt",
    );

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.type).toBe("document");
    expect(body.document.link).toBe("https://example.com/receipt.pdf");
    expect(body.document.caption).toBe("Your receipt");
  });
});
