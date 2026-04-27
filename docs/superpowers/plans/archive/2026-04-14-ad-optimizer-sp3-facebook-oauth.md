# Ad Optimizer SP3: Facebook OAuth Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first OAuth integration in Switchboard — a Facebook OAuth flow that lets buyers connect their Meta Ads account, with encrypted token storage, long-lived token exchange, and auto-refresh before expiry.

**Architecture:** Two API routes handle the OAuth flow (authorize redirect + callback). The callback exchanges the short-lived code for a long-lived token (60-day), queries the user's ad accounts for selection, encrypts the credentials via the existing `encryptCredentials` utility, and stores them in `DeploymentConnection`. A token refresh utility checks expiry before each API call and auto-refreshes. A new `updateCredentials` method is added to the connection store for refresh flows.

**Tech Stack:** Fastify routes, Meta Graph API (`fetch`), `@switchboard/db` (Prisma, credential encryption), Zod validation, vitest

**Spec:** `docs/superpowers/specs/2026-04-13-ad-optimizer-design.md` — Section 9

---

## File Structure

| Action | File                                                              | Responsibility                                                                                       |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Create | `packages/core/src/ad-optimizer/facebook-oauth.ts`                | OAuth URL builder, code-to-token exchange, long-lived token exchange, ad account list, token refresh |
| Create | `packages/core/src/ad-optimizer/__tests__/facebook-oauth.test.ts` | Tests for OAuth logic                                                                                |
| Create | `apps/api/src/routes/facebook-oauth.ts`                           | API routes: GET /authorize (redirect), GET /callback (exchange + store)                              |
| Modify | `apps/api/src/bootstrap/routes.ts`                                | Register OAuth routes                                                                                |
| Modify | `packages/db/src/stores/prisma-deployment-connection-store.ts`    | Add `updateCredentials` method                                                                       |
| Modify | `packages/core/src/ad-optimizer/index.ts`                         | Export OAuth module                                                                                  |
| Modify | `.env.example`                                                    | Add Facebook env vars                                                                                |

---

### Task 1: Connection Store — updateCredentials Method

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-connection-store.ts`

The token refresh flow needs to update credentials without recreating the connection.

- [ ] **Step 1: Read the existing store**

Read `packages/db/src/stores/prisma-deployment-connection-store.ts`.

- [ ] **Step 2: Add updateCredentials method**

Add after the existing `updateStatus` method:

```typescript
async updateCredentials(id: string, credentials: string, metadata?: Record<string, unknown>) {
  return this.prisma.deploymentConnection.update({
    where: { id },
    data: {
      credentials,
      ...(metadata ? { metadata: metadata as object } : {}),
    },
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/jasonljc/switchboard && git add packages/db/src/stores/prisma-deployment-connection-store.ts && git commit -m "feat(db): add updateCredentials to deployment connection store"
```

---

### Task 2: Facebook OAuth Core Module

**Files:**

- Create: `packages/core/src/ad-optimizer/facebook-oauth.ts`
- Create: `packages/core/src/ad-optimizer/__tests__/facebook-oauth.test.ts`

Pure logic for Facebook OAuth — URL building, token exchange, ad account listing, token refresh. All I/O is via injected `fetch`.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/ad-optimizer/__tests__/facebook-oauth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  refreshTokenIfNeeded,
  type FacebookOAuthConfig,
} from "../facebook-oauth.js";

const config: FacebookOAuthConfig = {
  appId: "test-app-id",
  appSecret: "test-app-secret",
  redirectUri: "https://app.example.com/api/connections/facebook/callback",
};

describe("buildAuthorizationUrl", () => {
  it("builds correct Facebook OAuth URL with scopes and state", () => {
    const url = buildAuthorizationUrl(config, "deployment-123");
    expect(url).toContain("https://www.facebook.com/v21.0/dialog/oauth");
    expect(url).toContain("client_id=test-app-id");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("scope=ads_read%2Cads_management%2Cbusiness_management");
    expect(url).toContain("state=deployment-123");
  });
});

describe("exchangeCodeForToken", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = mockFetch;
  });

  it("exchanges authorization code for short-lived token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "short-lived-token",
          token_type: "bearer",
          expires_in: 3600,
        }),
    });

    const result = await exchangeCodeForToken(config, "auth-code-123");
    expect(result.accessToken).toBe("short-lived-token");
    expect(result.expiresIn).toBe(3600);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("oauth/access_token"),
      expect.anything(),
    );
  });

  it("throws on failed exchange", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: "Invalid code" } }),
    });

    await expect(exchangeCodeForToken(config, "bad-code")).rejects.toThrow(
      "Facebook OAuth error (400): Invalid code",
    );
  });
});

describe("exchangeForLongLivedToken", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = mockFetch;
  });

  it("exchanges short-lived token for 60-day token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "long-lived-token",
          token_type: "bearer",
          expires_in: 5184000, // 60 days
        }),
    });

    const result = await exchangeForLongLivedToken(config, "short-lived-token");
    expect(result.accessToken).toBe("long-lived-token");
    expect(result.expiresIn).toBe(5184000);
  });
});

describe("listAdAccounts", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = mockFetch;
  });

  it("returns list of ad accounts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { account_id: "123", name: "My Business", currency: "USD", account_status: 1 },
            { account_id: "456", name: "Side Project", currency: "EUR", account_status: 1 },
          ],
        }),
    });

    const accounts = await listAdAccounts("test-token");
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toEqual({
      accountId: "123",
      name: "My Business",
      currency: "USD",
      status: 1,
    });
  });
});

describe("refreshTokenIfNeeded", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = mockFetch;
  });

  it("returns existing token when not near expiry", async () => {
    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
    const result = await refreshTokenIfNeeded(config, "current-token", futureExpiry);
    expect(result).toBeNull(); // null = no refresh needed
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refreshes token when within 7 days of expiry", async () => {
    const nearExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "refreshed-token",
          token_type: "bearer",
          expires_in: 5184000,
        }),
    });

    const result = await refreshTokenIfNeeded(config, "current-token", nearExpiry);
    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe("refreshed-token");
  });

  it("returns error info when refresh fails (token revoked)", async () => {
    const nearExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: { message: "Token revoked" } }),
    });

    await expect(refreshTokenIfNeeded(config, "revoked-token", nearExpiry)).rejects.toThrow(
      "Token revoked",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard/packages/core && npx vitest run src/ad-optimizer/__tests__/facebook-oauth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement facebook-oauth.ts**

```typescript
// packages/core/src/ad-optimizer/facebook-oauth.ts

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const OAUTH_DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";
const SCOPES = "ads_read,ads_management,business_management";
const REFRESH_THRESHOLD_DAYS = 7;

export interface FacebookOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface TokenResult {
  accessToken: string;
  expiresIn: number;
}

export interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
  status: number;
}

// ── Authorization URL ────────────────────────────────────────────────────────

export function buildAuthorizationUrl(config: FacebookOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    response_type: "code",
    state,
  });
  return `${OAUTH_DIALOG}?${params.toString()}`;
}

// ── Token Exchange ───────────────────────────────────────────────────────────

export async function exchangeCodeForToken(
  config: FacebookOAuthConfig,
  code: string,
): Promise<TokenResult> {
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  const response = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  const json = await handleResponse(response);
  return { accessToken: json.access_token as string, expiresIn: json.expires_in as number };
}

export async function exchangeForLongLivedToken(
  config: FacebookOAuthConfig,
  shortLivedToken: string,
): Promise<TokenResult> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: shortLivedToken,
  });
  const response = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  const json = await handleResponse(response);
  return { accessToken: json.access_token as string, expiresIn: json.expires_in as number };
}

// ── Ad Account Discovery ─────────────────────────────────────────────────────

export async function listAdAccounts(accessToken: string): Promise<AdAccount[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: "account_id,name,currency,account_status",
  });
  const response = await fetch(`${GRAPH_API_BASE}/me/adaccounts?${params.toString()}`);
  const json = await handleResponse(response);
  const data = (json.data ?? []) as Array<Record<string, unknown>>;
  return data.map((a) => ({
    accountId: a.account_id as string,
    name: a.name as string,
    currency: a.currency as string,
    status: a.account_status as number,
  }));
}

// ── Token Refresh ────────────────────────────────────────────────────────────

export async function refreshTokenIfNeeded(
  config: FacebookOAuthConfig,
  currentToken: string,
  expiresAt: string,
): Promise<TokenResult | null> {
  const expiryDate = new Date(expiresAt);
  const daysUntilExpiry = (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry > REFRESH_THRESHOLD_DAYS) {
    return null; // No refresh needed
  }

  return exchangeForLongLivedToken(config, currentToken);
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function handleResponse(response: Response): Promise<Record<string, unknown>> {
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(
      `Facebook OAuth error (${response.status}): ${err?.message ?? "Unknown error"}`,
    );
  }
  return json;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard/packages/core && npx vitest run src/ad-optimizer/__tests__/facebook-oauth.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonljc/switchboard && git add packages/core/src/ad-optimizer/facebook-oauth.ts packages/core/src/ad-optimizer/__tests__/facebook-oauth.test.ts && git commit -m "feat: add Facebook OAuth module — URL builder, token exchange, refresh"
```

---

### Task 3: Facebook OAuth API Routes

**Files:**

- Create: `apps/api/src/routes/facebook-oauth.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

Two routes: authorization redirect and callback handler. The callback exchanges the code for a long-lived token, stores encrypted credentials in `DeploymentConnection`.

- [ ] **Step 1: Create the route file**

```typescript
// apps/api/src/routes/facebook-oauth.ts
import type { FastifyPluginAsync } from "fastify";
import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
} from "@switchboard/core/ad-optimizer";
import type { FacebookOAuthConfig } from "@switchboard/core/ad-optimizer";
import {
  PrismaDeploymentConnectionStore,
  encryptCredentials,
  decryptCredentials,
} from "@switchboard/db";

function getOAuthConfig(): FacebookOAuthConfig {
  return {
    appId: process.env["FACEBOOK_APP_ID"] ?? "",
    appSecret: process.env["FACEBOOK_APP_SECRET"] ?? "",
    redirectUri: process.env["FACEBOOK_REDIRECT_URI"] ?? "",
  };
}

export const facebookOAuthRoutes: FastifyPluginAsync = async (app) => {
  // Step 1: Redirect buyer to Facebook's OAuth dialog
  app.get<{
    Querystring: { deploymentId: string };
  }>("/facebook/authorize", async (request, reply) => {
    const { deploymentId } = request.query;
    if (!deploymentId) {
      return reply.code(400).send({ error: "deploymentId is required" });
    }

    const config = getOAuthConfig();
    if (!config.appId) {
      return reply.code(503).send({ error: "Facebook OAuth not configured" });
    }

    const authUrl = buildAuthorizationUrl(config, deploymentId);
    return reply.redirect(authUrl);
  });

  // Step 2: Handle Facebook's callback with authorization code
  app.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/facebook/callback", async (request, reply) => {
    const { code, state: deploymentId, error, error_description } = request.query;

    if (error) {
      app.log.warn({ error, error_description }, "Facebook OAuth denied");
      return reply.code(400).send({ error: error_description ?? "OAuth denied" });
    }

    if (!code || !deploymentId) {
      return reply.code(400).send({ error: "Missing code or state" });
    }

    const config = getOAuthConfig();

    try {
      // Exchange code for short-lived token
      const shortLived = await exchangeCodeForToken(config, code);

      // Exchange for long-lived token (60-day)
      const longLived = await exchangeForLongLivedToken(config, shortLived.accessToken);

      // Get buyer's ad accounts
      const adAccounts = await listAdAccounts(longLived.accessToken);

      if (adAccounts.length === 0) {
        return reply.code(400).send({ error: "No ad accounts found for this Facebook user" });
      }

      // Use first active account (multi-account selection deferred to dashboard SP)
      const selectedAccount = adAccounts.find((a) => a.status === 1) ?? adAccounts[0];

      // Store encrypted credentials in DeploymentConnection
      const expiresAt = new Date(Date.now() + longLived.expiresIn * 1000).toISOString();
      const credentials = encryptCredentials({
        accessToken: longLived.accessToken,
        accountId: `act_${selectedAccount.accountId}`,
        accountName: selectedAccount.name,
        currency: selectedAccount.currency,
        expiresAt,
      });

      if (!app.prisma) {
        return reply.code(503).send({ error: "Database not available" });
      }

      const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
      await connectionStore.create({
        deploymentId,
        type: "meta-ads",
        credentials,
        metadata: {
          accountId: `act_${selectedAccount.accountId}`,
          accountName: selectedAccount.name,
          expiresAt,
        },
      });

      app.log.info(
        { deploymentId, accountId: selectedAccount.accountId },
        "Facebook Ads connected via OAuth",
      );

      // Redirect back to dashboard deployment page
      const dashboardUrl = process.env["DASHBOARD_URL"] ?? "http://localhost:3002";
      return reply.redirect(
        `${dashboardUrl}/marketplace/deployments/${deploymentId}?connected=true`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "OAuth exchange failed";
      app.log.error(err, "Facebook OAuth callback error");
      return reply.code(500).send({ error: message });
    }
  });

  // Step 3: List ad accounts for a given deployment's OAuth token
  app.get<{
    Params: { deploymentId: string };
  }>("/facebook/:deploymentId/accounts", async (request, reply) => {
    if (!app.prisma) {
      return reply.code(503).send({ error: "Database not available" });
    }

    const { deploymentId } = request.params;
    const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
    const connections = await connectionStore.listByDeployment(deploymentId);
    const conn = connections.find((c) => c.type === "meta-ads");

    if (!conn) {
      return reply.code(404).send({ error: "No Meta Ads connection found" });
    }

    // Decrypt to get access token, then list accounts
    const creds = decryptCredentials(conn.credentials);
    const accounts = await listAdAccounts(creds.accessToken as string);

    return reply.send({ accounts });
  });
};
```

- [ ] **Step 2: Register in routes bootstrap**

Read `apps/api/src/bootstrap/routes.ts` and add:

```typescript
import { facebookOAuthRoutes } from "../routes/facebook-oauth.js";
```

And in the registration block (near other marketplace routes):

```typescript
await app.register(facebookOAuthRoutes, { prefix: "/api/connections" });
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/jasonljc/switchboard/apps/api && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonljc/switchboard && git add apps/api/src/routes/facebook-oauth.ts apps/api/src/bootstrap/routes.ts && git commit -m "feat(api): add Facebook OAuth routes — authorize, callback, account list"
```

---

### Task 4: Update Barrel Exports + Environment Variables

**Files:**

- Modify: `packages/core/src/ad-optimizer/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add Facebook OAuth exports to barrel**

Add to `packages/core/src/ad-optimizer/index.ts`:

```typescript
export {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  listAdAccounts,
  refreshTokenIfNeeded,
} from "./facebook-oauth.js";
export type { FacebookOAuthConfig, TokenResult, AdAccount } from "./facebook-oauth.js";
```

- [ ] **Step 2: Add Facebook env vars to .env.example**

Add to `.env.example`:

```bash
# Facebook / Meta Ads OAuth
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=http://localhost:3000/api/connections/facebook/callback
DASHBOARD_URL=http://localhost:3002
```

- [ ] **Step 3: Build and verify**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core build
```

- [ ] **Step 4: Run all ad-optimizer tests**

```bash
cd /Users/jasonljc/switchboard/packages/core && npx vitest run src/ad-optimizer/
```

Expected: All tests pass (66 from SP1+SP2 + new OAuth tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonljc/switchboard && git add packages/core/src/ad-optimizer/index.ts .env.example && git commit -m "feat: export Facebook OAuth module + add env vars to .env.example"
```

---

## What's Next

This plan covers **Phase 10** of the build order. Subsequent plans:

- **SP4:** Marketplace listing seed data (Phase 11)
- **SP5:** Dashboard — audit summary card, output feed, trend charts (Phase 12)
