/**
 * EV-14 / CHAN-7 — dashboard API client is bound to the session user's own org.
 *
 * getApiClient() looks up the dashboard user by `session.user.id` and builds a
 * SwitchboardClient with THAT user's encrypted API key. The API key is the org
 * binding (the API auth middleware maps it to the user's org). The lookup is
 * keyed by the authenticated session's own user id, so a session for user A can
 * only ever yield user A's key — never user B's / another org's. TEST-ONLY.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireSessionMock, dashboardUserFindUnique, decryptApiKeyMock, clientCtor } = vi.hoisted(
  () => ({
    requireSessionMock: vi.fn(),
    dashboardUserFindUnique: vi.fn(),
    decryptApiKeyMock: vi.fn((enc: string) => enc.replace("enc_", "key_")),
    clientCtor: vi.fn(),
  }),
);

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    dashboardUser: { findUnique: dashboardUserFindUnique },
  })),
  KnowledgeKind: { playbook: "playbook", policy: "policy", knowledge: "knowledge" },
}));
vi.mock("../session", () => ({ requireSession: requireSessionMock }));
vi.mock("../crypto", () => ({ decryptApiKey: decryptApiKeyMock }));
vi.mock("../dev-auth", () => ({ isDevBypassEnabled: () => false }));
vi.mock("../api-client", () => ({
  SwitchboardClient: class {
    constructor(baseUrl: string, apiKey: string) {
      clientCtor(baseUrl, apiKey);
    }
  },
}));

import { getApiClient } from "../get-api-client";

// Two users in two orgs, each with their own encrypted key.
const USERS: Record<string, { id: string; apiKeyEncrypted: string }> = {
  user_A: { id: "user_A", apiKeyEncrypted: "enc_A" },
  user_B: { id: "user_B", apiKeyEncrypted: "enc_B" },
};

describe("CHAN-7 dashboard get-api-client org binding", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    dashboardUserFindUnique.mockReset();
    clientCtor.mockReset();
    process.env.SWITCHBOARD_API_URL = "https://api.test";
    dashboardUserFindUnique.mockImplementation(
      async (args: { where: { id: string } }) => USERS[args.where.id] ?? null,
    );
  });

  it("binds the client to the session user's OWN key (user A -> key A)", async () => {
    requireSessionMock.mockResolvedValue({ user: { id: "user_A" } });
    await getApiClient();
    // Looked up by the authenticated session's own id, then built with its key.
    expect(dashboardUserFindUnique).toHaveBeenCalledWith({ where: { id: "user_A" } });
    expect(clientCtor).toHaveBeenCalledWith("https://api.test", "key_A");
  });

  it("a different session binds to a different org's key (user B -> key B, never A)", async () => {
    requireSessionMock.mockResolvedValue({ user: { id: "user_B" } });
    await getApiClient();
    expect(dashboardUserFindUnique).toHaveBeenCalledWith({ where: { id: "user_B" } });
    const [, apiKey] = clientCtor.mock.calls[0]!;
    expect(apiKey).toBe("key_B");
    expect(apiKey).not.toBe("key_A");
  });

  it("never queries by any id other than the session user's (no cross-user key access)", async () => {
    requireSessionMock.mockResolvedValue({ user: { id: "user_A" } });
    await getApiClient();
    for (const call of dashboardUserFindUnique.mock.calls) {
      expect(call[0]).toEqual({ where: { id: "user_A" } });
    }
  });
});
