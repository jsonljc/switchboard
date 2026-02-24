import { createHmac, timingSafeEqual } from "node:crypto";

export interface ChannelSecurityConfig {
  signatureHeader: string;
  signatureAlgorithm: "hmac-sha256" | "rsa-sha256" | "ed25519";
  signatureSecret: string;
  timestampHeader: string | null;
  maxTimestampDriftMs: number;
  nonceTracking: boolean;
  ingressRateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

// In-memory stores for dev; in production, use Redis
const processedMessages = new Map<string, number>();
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

export function verifySignature(
  body: string,
  signature: string,
  secret: string,
  algorithm: string,
): boolean {
  if (algorithm === "hmac-sha256") {
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    // Try both raw hex and prefixed formats, using timing-safe comparison
    try {
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return true;
    } catch { /* length mismatch */ }
    try {
      const prefixed = `sha256=${expected}`;
      if (timingSafeEqual(Buffer.from(prefixed), Buffer.from(signature))) return true;
    } catch { /* length mismatch */ }
    return false;
  }
  // RSA-SHA256 and Ed25519 are not yet implemented — deny by default
  console.warn(`[security] Unsupported signature algorithm: ${algorithm}`);
  return false;
}

export function checkTimestamp(
  timestampHeader: string | null,
  maxDriftMs: number,
  headers: Record<string, string | undefined>,
): boolean {
  if (!timestampHeader) return true;

  const rawTimestamp = headers[timestampHeader];
  if (!rawTimestamp) return false;

  const timestamp = parseInt(rawTimestamp, 10) * 1000;
  return Math.abs(Date.now() - timestamp) <= maxDriftMs;
}

export function checkNonce(messageId: string, driftWindowMs: number): boolean {
  const existing = processedMessages.get(messageId);
  if (existing && Date.now() - existing < driftWindowMs) {
    return false; // Already processed
  }
  processedMessages.set(messageId, Date.now());

  // Cleanup old entries
  for (const [id, time] of processedMessages) {
    if (Date.now() - time > driftWindowMs) {
      processedMessages.delete(id);
    }
  }

  return true;
}

export function checkIngressRateLimit(
  sourceKey: string,
  config: { windowMs: number; maxRequests: number },
): boolean {
  const now = Date.now();
  const entry = rateLimitCounters.get(sourceKey);

  if (!entry || now - entry.windowStart > config.windowMs) {
    rateLimitCounters.set(sourceKey, { count: 1, windowStart: now });
    return true;
  }

  entry.count++;
  return entry.count <= config.maxRequests;
}

export async function verifyChannelWebhook(
  rawBody: string,
  headers: Record<string, string | undefined>,
  sourceIp: string,
  messageId: string | null,
  config: ChannelSecurityConfig,
): Promise<{ allowed: boolean; reason?: string }> {
  // 1. Verify signature
  const signature = headers[config.signatureHeader.toLowerCase()];
  if (!signature) {
    return { allowed: false, reason: "Missing signature header" };
  }

  if (!verifySignature(rawBody, signature, config.signatureSecret, config.signatureAlgorithm)) {
    return { allowed: false, reason: "Invalid signature" };
  }

  // 2. Replay protection (timestamp)
  if (!checkTimestamp(config.timestampHeader, config.maxTimestampDriftMs, headers)) {
    return { allowed: false, reason: "Timestamp too old or missing" };
  }

  // 3. Nonce dedup
  if (config.nonceTracking && messageId) {
    if (!checkNonce(messageId, config.maxTimestampDriftMs)) {
      return { allowed: false, reason: "Duplicate message" };
    }
  }

  // 4. Ingress rate limit
  if (!checkIngressRateLimit(sourceIp, config.ingressRateLimit)) {
    return { allowed: false, reason: "Rate limit exceeded" };
  }

  return { allowed: true };
}
