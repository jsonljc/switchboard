import { describe, it, expect } from "vitest";

describe("non-text message handling", () => {
  it("returns unsupported message instead of null for images", () => {
    const message = parseNonTextMessage("image");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["unsupported"]).toBe(true);
    expect(message?.metadata?.["originalType"]).toBe("image");
  });

  it("returns unsupported message for voice", () => {
    const message = parseNonTextMessage("voice");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["unsupported"]).toBe(true);
    expect(message?.metadata?.["originalType"]).toBe("voice");
  });

  it("returns unsupported message for video", () => {
    const message = parseNonTextMessage("video");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["originalType"]).toBe("video");
  });

  it("returns unsupported message for sticker", () => {
    const message = parseNonTextMessage("sticker");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["originalType"]).toBe("sticker");
  });

  it("returns unsupported message for location", () => {
    const message = parseNonTextMessage("location");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["originalType"]).toBe("location");
  });

  it("returns unsupported message for document", () => {
    const message = parseNonTextMessage("document");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["originalType"]).toBe("document");
  });
});

function parseNonTextMessage(
  msgType: string,
): { text: string; metadata?: Record<string, unknown> } | null {
  if (["image", "voice", "audio", "video", "sticker", "location", "document"].includes(msgType)) {
    return {
      text: "",
      metadata: { unsupported: true, originalType: msgType },
    };
  }
  return null;
}
