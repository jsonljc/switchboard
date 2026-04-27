import type { IncomingMessage } from "@switchboard/schemas";

export const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

export function extractWhatsAppValue(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const entry = (payload["entry"] as Array<Record<string, unknown>>)?.[0];
  if (!entry) return null;

  const changes = (entry["changes"] as Array<Record<string, unknown>>)?.[0];
  if (!changes) return null;

  const value = changes["value"] as Record<string, unknown> | undefined;
  return value ?? null;
}

export function extractContactName(value: Record<string, unknown>): string | undefined {
  const contacts = value["contacts"] as Array<Record<string, unknown>> | undefined;
  return (contacts?.[0]?.["profile"] as Record<string, unknown>)?.["name"] as string | undefined;
}

export function extractReferralData(msg: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const referral = msg["referral"] as Record<string, unknown> | undefined;
  if (referral) {
    if (referral["source_id"]) metadata["sourceAdId"] = referral["source_id"];
    if (referral["source_type"]) metadata["adSourceType"] = referral["source_type"];
    if (referral["source_url"]) metadata["ctwaSourceUrl"] = referral["source_url"];
    if (referral["ctwa_clid"]) metadata["ctwaClid"] = referral["ctwa_clid"];
    if (referral["headline"]) metadata["adHeadline"] = referral["headline"];
    if (referral["body"]) metadata["adBody"] = referral["body"];
  }
  return metadata;
}

export function parseInteractiveMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
): IncomingMessage | null {
  const interactive = msg["interactive"] as Record<string, unknown> | undefined;
  if (!interactive) return null;

  const interactiveType = interactive["type"] as string;
  let text: string | undefined;

  if (interactiveType === "button_reply") {
    const buttonReply = interactive["button_reply"] as Record<string, unknown> | undefined;
    text = buttonReply?.["id"] as string | undefined;
  } else if (interactiveType === "list_reply") {
    const listReply = interactive["list_reply"] as Record<string, unknown> | undefined;
    text = listReply?.["id"] as string | undefined;
  } else if (interactiveType === "nfm_reply") {
    const nfmReply = interactive["nfm_reply"] as Record<string, unknown> | undefined;
    if (nfmReply?.["response_json"]) {
      try {
        const flowResponse = JSON.parse(nfmReply["response_json"] as string);
        const from = msg["from"] as string;
        const msgId = msg["id"] as string;
        const timestamp = msg["timestamp"] as string;
        const contactName = extractContactName(value);

        const metadata: Record<string, unknown> = {
          interactiveType: "nfm_reply",
          flowResponse,
        };
        if (contactName) metadata["contactName"] = contactName;

        return {
          id: msgId ?? `wa_${Date.now()}`,
          channel: "whatsapp",
          channelMessageId: msgId ?? `wa_${Date.now()}`,
          principalId: from ?? "unknown",
          text: JSON.stringify(flowResponse),
          threadId: from,
          timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
          metadata,
          attachments: [],
          organizationId: null,
        };
      } catch {
        // Invalid JSON in response_json — fall through
      }
    }
  }

  if (!text) return null;

  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const metadata: Record<string, unknown> = { interactiveType };
  if (contactName) metadata["contactName"] = contactName;

  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text,
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments: [],
    organizationId: null,
  };
}

export function parseMediaMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
  msgType: string,
): IncomingMessage {
  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const mediaObj = msg[msgType] as Record<string, unknown> | undefined;
  const mediaId = mediaObj?.["id"] as string | undefined;
  const filename = mediaObj?.["filename"] as string | undefined;

  const metadata: Record<string, unknown> = { originalType: msgType };
  if (contactName) metadata["contactName"] = contactName;
  if (mediaId) metadata["mediaId"] = mediaId;

  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  const attachments: Array<{
    type: string;
    url: string | null;
    data: unknown;
    filename: string | null;
  }> = [];
  if (mediaId) {
    attachments.push({
      type: msgType,
      url: null,
      data: { mediaId },
      filename: filename ?? null,
    });
  }

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text: "",
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments,
    organizationId: null,
  };
}

export function parseUnsupportedMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
  msgType: string,
): IncomingMessage {
  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const metadata: Record<string, unknown> = { unsupported: true, originalType: msgType };
  if (contactName) metadata["contactName"] = contactName;

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text: "",
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments: [],
    organizationId: null,
  };
}

export function parseTextMessage(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
): IncomingMessage | null {
  const textObj = msg["text"] as Record<string, unknown>;
  const text = textObj?.["body"] as string;
  if (!text) return null;

  const from = msg["from"] as string;
  const msgId = msg["id"] as string;
  const timestamp = msg["timestamp"] as string;
  const contactName = extractContactName(value);

  const metadata: Record<string, unknown> = {};
  if (contactName) metadata["contactName"] = contactName;

  const referralData = extractReferralData(msg);
  Object.assign(metadata, referralData);

  return {
    id: msgId ?? `wa_${Date.now()}`,
    channel: "whatsapp",
    channelMessageId: msgId ?? `wa_${Date.now()}`,
    principalId: from ?? "unknown",
    text,
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata,
    attachments: [],
    organizationId: null,
  };
}
