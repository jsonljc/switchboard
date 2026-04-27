import { describe, it, expect } from "vitest";
import { buildManagedWebhookPath } from "../managed-webhook-path.js";

describe("buildManagedWebhookPath", () => {
  it("produces /webhook/managed/<connectionId>", () => {
    const path = buildManagedWebhookPath("conn_abc12345");
    expect(path).toBe("/webhook/managed/conn_abc12345");
  });

  it("matches the chat-server route pattern (independent regex pin)", () => {
    // External contract pinned: /webhook/managed/:connectionId
    // This regex is mirrored in apps/chat/src/__tests__/whatsapp-wiring.test.ts.
    // Duplication is intentional; do not introduce a cross-app import.
    const MANAGED_WEBHOOK_PATH = /^\/webhook\/managed\/[a-zA-Z0-9_-]+$/;
    expect(buildManagedWebhookPath("conn_abc12345")).toMatch(MANAGED_WEBHOOK_PATH);
    expect(buildManagedWebhookPath("conn_xyz789")).toMatch(MANAGED_WEBHOOK_PATH);
  });
});
