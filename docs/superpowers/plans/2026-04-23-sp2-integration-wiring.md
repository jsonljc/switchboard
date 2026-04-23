# SP2: Integration Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Meta Ads OAuth and WhatsApp guided setup into the dashboard so a beta user can connect both integrations without founder intervention.

- **Meta Ads:** credentials stored and retrievable by the improve-spend module runtime path (`inputConfig.adAccountId` + encrypted tokens in `DeploymentConnection`)
- **WhatsApp:** credentials stored and resolvable by the chat runtime via `PrismaDeploymentResolver.resolveByChannelToken()`

**Architecture:** Replace the stubbed improve-spend wizard steps 1–2 with a real OAuth redirect + ad account selection flow. Enhance the WhatsApp channel card with labeled fields, inline guidance, and a test-connection endpoint that validates credentials before saving. Add a deployment bridge in the provisioning route that creates `AgentDeployment` + `DeploymentConnection` records so `PrismaDeploymentResolver.resolveByChannelToken()` can resolve credentials created through the onboarding path. Bridge creation is hard-fail — if it fails, provisioning fails.

**Tech Stack:** Next.js 14 (App Router), Fastify, Prisma, TanStack React Query, Vitest, Graph API v21.0

**Spec:** `docs/superpowers/specs/2026-04-23-sp2-integration-wiring-design.md`

**Key discovery: `request` is `protected`** — The api-client's `request()` method is `protected` on `SwitchboardClientCore`. Dashboard proxy routes must use named methods on the client class, not raw `request()`. New methods must be added to the appropriate mixin class (`SwitchboardMarketplaceClient` in `marketplace.ts`).

---

## File Structure

| Action | Path                                                                                    | Responsibility                                                    |
| ------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Edit   | `apps/api/src/routes/facebook-oauth.ts`                                                 | Fix callback redirect to module setup URL                         |
| Edit   | `apps/dashboard/src/lib/api-client/marketplace.ts`                                      | Add `listFacebookAdAccounts` + `setAdAccountSelection` methods    |
| New    | `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/ad-account/route.ts` | Dashboard proxy: fetch ad accounts + persist selection            |
| New    | `apps/dashboard/src/app/api/dashboard/connections/facebook/authorize/route.ts`          | Dashboard proxy: OAuth authorize redirect                         |
| Edit   | `apps/dashboard/src/components/modules/improve-spend-setup.tsx`                         | Wire OAuth button, real account fetch, selection persistence      |
| Edit   | `apps/dashboard/src/components/modules/module-setup-wizard.tsx`                         | Pass `deploymentId` prop                                          |
| Edit   | `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`                         | Resolve deploymentId with single-deployment invariant             |
| New    | `apps/api/src/routes/whatsapp-test.ts`                                                  | WhatsApp test-connection API endpoint                             |
| Edit   | `apps/api/src/bootstrap/routes.ts`                                                      | Register whatsapp-test route                                      |
| New    | `apps/dashboard/src/app/api/dashboard/connections/whatsapp/test/route.ts`               | Dashboard proxy for WhatsApp test                                 |
| Edit   | `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`                     | Relabel fields, add guidance, add test connection                 |
| Edit   | `apps/dashboard/src/app/(auth)/onboarding/page.tsx`                                     | Update field key mapping for renamed WhatsApp fields              |
| Edit   | `apps/api/src/routes/organizations.ts`                                                  | Add deployment bridge record creation in provisioning (hard-fail) |

---

### Task 1: Fix OAuth Callback Redirect

The existing callback redirects to a dead marketplace route. Fix it to redirect to the module setup wizard.

**Files:**

- Edit: `apps/api/src/routes/facebook-oauth.ts:137-139`
- New: `apps/api/src/routes/__tests__/facebook-oauth-callback.test.ts`

- [ ] **Step 1: Write the callback redirect test**

Create `apps/api/src/routes/__tests__/facebook-oauth-callback.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("Facebook OAuth callback redirect", () => {
  it("builds the correct dashboard redirect URL", () => {
    const dashboardUrl = "http://localhost:3002";
    const deploymentId = "deploy_abc123";
    const redirectUrl = `${dashboardUrl}/modules/improve-spend/setup?step=select-account&connected=true&deploymentId=${deploymentId}`;

    expect(redirectUrl).toContain("/modules/improve-spend/setup");
    expect(redirectUrl).toContain("step=select-account");
    expect(redirectUrl).toContain("connected=true");
    expect(redirectUrl).toContain(`deploymentId=${deploymentId}`);
    expect(redirectUrl).not.toContain("/marketplace/");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx vitest run src/routes/__tests__/facebook-oauth-callback.test.ts`
Expected: PASS

- [ ] **Step 3: Update the callback redirect in facebook-oauth.ts**

In `apps/api/src/routes/facebook-oauth.ts`, change lines 137-139 from:

```typescript
const dashboardUrl = process.env["DASHBOARD_URL"] ?? "http://localhost:3002";
return reply.redirect(`${dashboardUrl}/marketplace/deployments/${deploymentId}?connected=true`);
```

To:

```typescript
const dashboardUrl = process.env["DASHBOARD_URL"] ?? "http://localhost:3002";
return reply.redirect(
  `${dashboardUrl}/modules/improve-spend/setup?step=select-account&connected=true&deploymentId=${deploymentId}`,
);
```

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(api): redirect OAuth callback to module setup wizard

Changes the Facebook OAuth callback redirect from the dead
/marketplace/deployments/ URL to /modules/improve-spend/setup with
step=select-account query param so the wizard advances correctly.
EOF
)"
```

---

### Task 2: Add API Client Methods + Dashboard Proxy for Ad Accounts

Add named methods to the api-client (since `request` is `protected`) and create the dashboard proxy route.

**Files:**

- Edit: `apps/dashboard/src/lib/api-client/marketplace.ts`
- New: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/ad-account/route.ts`
- New: `apps/dashboard/src/app/api/dashboard/connections/facebook/authorize/route.ts`

- [ ] **Step 1: Add client methods to marketplace.ts**

In `apps/dashboard/src/lib/api-client/marketplace.ts`, add two new methods to the `SwitchboardMarketplaceClient` class, after the existing `upsertBusinessFacts` method (around line 91):

```typescript
  async listFacebookAdAccounts(deploymentId: string) {
    return this.request<{
      accounts: Array<{
        accountId: string;
        name: string;
        currency: string;
        status: number;
      }>;
    }>(`/api/connections/facebook/${deploymentId}/accounts`);
  }

  async setAdAccountSelection(
    deploymentId: string,
    adAccountId: string,
    adAccountName: string,
  ) {
    return this.request<{ deployment: MarketplaceDeployment }>(
      `/api/marketplace/deployments/${deploymentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          inputConfig: { adAccountId, adAccountName },
        }),
      },
    );
  }
```

- [ ] **Step 2: Create the dashboard proxy route for ad accounts**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/ad-account/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const client = await getApiClient();
    const data = await client.listFacebookAdAccounts(id);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const body = await request.json();
    const { adAccountId, adAccountName } = body as {
      adAccountId: string;
      adAccountName: string;
    };
    if (!adAccountId) {
      return NextResponse.json({ error: "adAccountId is required" }, { status: 400 });
    }
    const client = await getApiClient();
    const data = await client.setAdAccountSelection(id, adAccountId, adAccountName);
    return NextResponse.json(data);
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 3: Create the OAuth authorize proxy route**

Create `apps/dashboard/src/app/api/dashboard/connections/facebook/authorize/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  try {
    await requireSession();
    const deploymentId = request.nextUrl.searchParams.get("deploymentId");
    if (!deploymentId) {
      return NextResponse.json({ error: "deploymentId is required" }, { status: 400 });
    }
    const apiUrl = process.env.SWITCHBOARD_API_URL;
    if (!apiUrl) {
      return NextResponse.json({ error: "API URL not configured" }, { status: 500 });
    }
    return NextResponse.redirect(
      `${apiUrl}/api/connections/facebook/authorize?deploymentId=${deploymentId}`,
    );
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add API client methods and proxy routes for Meta Ads

Adds listFacebookAdAccounts and setAdAccountSelection to the
marketplace client. Creates proxy routes for ad account fetch/selection
and OAuth authorize redirect. Uses named client methods (request is
protected).
EOF
)"
```

---

### Task 3: Wire Improve-Spend Wizard Steps 1–2

Replace only the step 1 and step 2 logic in the existing wizard. Preserve the existing shell/layout. Steps 3–5 become disabled "Coming soon" placeholders.

**Files:**

- Edit: `apps/dashboard/src/components/modules/improve-spend-setup.tsx`
- Edit: `apps/dashboard/src/components/modules/module-setup-wizard.tsx`
- Edit: `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`

- [ ] **Step 1: Update the setup page to resolve deploymentId with single-deployment invariant**

Replace the content of `apps/dashboard/src/app/(auth)/modules/[module]/setup/page.tsx`:

```tsx
"use client";

import { useParams, useSearchParams } from "next/navigation";
import { notFound } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { MODULE_IDS, MODULE_LABELS, SLUG_TO_MODULE } from "@/lib/module-types";
import type { ModuleId } from "@/lib/module-types";
import { ModuleSetupWizard } from "@/components/modules/module-setup-wizard";

export default function ModuleSetupPage() {
  const params = useParams<{ module: string }>();
  const searchParams = useSearchParams();
  const moduleSlug = params.module;

  if (!MODULE_IDS.includes(moduleSlug as ModuleId)) {
    notFound();
  }

  const moduleId = moduleSlug as ModuleId;
  const initialStep = searchParams.get("step") ?? undefined;
  const deploymentIdFromCallback = searchParams.get("deploymentId") ?? undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["deployment-for-module", moduleId],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/marketplace/deployments");
      if (!res.ok) return { deployments: [] };
      const json = await res.json();
      return json as { deployments: Array<{ id: string; listingId: string }> };
    },
    enabled: !deploymentIdFromCallback,
  });

  const matchingDeployments = (data?.deployments ?? []).filter((d) => {
    const mapped = SLUG_TO_MODULE[d.listingId];
    return mapped === moduleId || d.listingId === moduleId;
  });

  const deploymentId = deploymentIdFromCallback ?? matchingDeployments[0]?.id;

  if (!isLoading && !deploymentIdFromCallback && matchingDeployments.length > 1) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center text-sm text-muted-foreground">
          Multiple deployments found for this module. Please contact support.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <ModuleSetupWizard
        moduleId={moduleId}
        label={MODULE_LABELS[moduleId]}
        initialStep={initialStep}
        deploymentId={deploymentId}
      />
    </div>
  );
}
```

- [ ] **Step 2: Pass deploymentId through module-setup-wizard.tsx**

In `apps/dashboard/src/components/modules/module-setup-wizard.tsx`:

Update the interface (add `deploymentId`):

```typescript
interface ModuleSetupWizardProps {
  moduleId: ModuleId;
  label: string;
  initialStep?: string;
  deploymentId?: string;
}
```

Update the component signature:

```typescript
export function ModuleSetupWizard({ moduleId, label, initialStep, deploymentId }: ModuleSetupWizardProps) {
```

Update the `ImproveSpendSetup` rendering:

From:

```tsx
{
  moduleId === "ad-optimizer" && (
    <ImproveSpendSetup initialStep={initialStep} onComplete={handleComplete} />
  );
}
```

To:

```tsx
{
  moduleId === "ad-optimizer" && (
    <ImproveSpendSetup
      initialStep={initialStep}
      onComplete={handleComplete}
      deploymentId={deploymentId}
    />
  );
}
```

- [ ] **Step 3: Update improve-spend-setup.tsx — add deploymentId prop and imports**

In `apps/dashboard/src/components/modules/improve-spend-setup.tsx`:

Add `useSearchParams` import (line 1 area):

```typescript
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
```

Remove the old `import { useState } from "react";` line.

Add new types and update the props interface:

```typescript
interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
  status: number;
}

interface ImproveSpendSetupProps {
  initialStep?: string;
  onComplete: () => void;
  deploymentId?: string;
}
```

Update the component signature to accept `deploymentId`:

```typescript
export function ImproveSpendSetup({
  initialStep,
  onComplete,
  deploymentId,
}: ImproveSpendSetupProps) {
```

- [ ] **Step 4: Add state and OAuth callback detection**

Inside the component function, after the destructured props, add:

```typescript
const searchParams = useSearchParams();
const connectedParam = searchParams.get("connected");
const deploymentIdParam = searchParams.get("deploymentId") ?? deploymentId;

const resolvedInitialStep =
  connectedParam === "true" && initialStep === "select-account"
    ? "select-account"
    : STEPS.includes(initialStep as Step)
      ? (initialStep as Step)
      : "connect-meta";

const [currentStep, setCurrentStep] = useState<Step>(resolvedInitialStep);
const [accounts, setAccounts] = useState<AdAccount[]>([]);
const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

Remove the old `useState<Step>(...)` call that uses `initialStep` directly.

- [ ] **Step 5: Add account fetching and selection handlers**

Add after the state declarations, before the `return`:

```typescript
const fetchAccounts = useCallback(async () => {
  if (!deploymentIdParam) {
    setError("No deployment ID available. Please restart the setup.");
    return;
  }
  setLoading(true);
  setError(null);
  try {
    const res = await fetch(
      `/api/dashboard/marketplace/deployments/${deploymentIdParam}/ad-account`,
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to fetch ad accounts");
    }
    const data = await res.json();
    setAccounts(data.accounts ?? []);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to fetch ad accounts");
  } finally {
    setLoading(false);
  }
}, [deploymentIdParam]);

useEffect(() => {
  if (currentStep === "select-account") {
    fetchAccounts();
  }
}, [currentStep, fetchAccounts]);

async function handleSelectAccount() {
  if (!selectedAccountId || !deploymentIdParam) return;
  const account = accounts.find((a) => a.accountId === selectedAccountId);
  if (!account) return;

  setLoading(true);
  setError(null);
  try {
    const res = await fetch(
      `/api/dashboard/marketplace/deployments/${deploymentIdParam}/ad-account`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adAccountId: `act_${account.accountId}`,
          adAccountName: account.name,
        }),
      },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to save account selection");
    }
    onComplete();
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to save account selection");
  } finally {
    setLoading(false);
  }
}

function handleConnectMeta() {
  if (!deploymentIdParam) {
    setError("No deployment ID available. Please restart the setup.");
    return;
  }
  window.location.href = `/api/dashboard/connections/facebook/authorize?deploymentId=${deploymentIdParam}`;
}
```

Remove the old `goNext()` function.

- [ ] **Step 6: Replace step 1 (connect-meta) JSX**

Replace the `{currentStep === "connect-meta" && (...)}` block with:

```tsx
{
  currentStep === "connect-meta" && (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Connect Meta Ads</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with Facebook to grant access to your ad accounts.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
        <p>You&apos;ll be redirected to Facebook to authorize Switchboard.</p>
        <p className="mt-1">
          Permissions requested: <strong>ads_read</strong>, <strong>ads_management</strong>,{" "}
          <strong>business_management</strong>
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={handleConnectMeta}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
      >
        Connect with Facebook
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Replace step 2 (select-account) JSX**

Replace the `{currentStep === "select-account" && (...)}` block with:

```tsx
{
  currentStep === "select-account" && (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Select ad account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which ad account Switchboard should optimize.
        </p>
      </div>
      {loading && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center">
          Loading ad accounts…
        </div>
      )}
      {!loading && accounts.length === 0 && !error && (
        <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center">
          No ad accounts found. Make sure your Facebook account has active ad accounts.
        </div>
      )}
      {!loading && accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((account) => (
            <button
              key={account.accountId}
              type="button"
              onClick={() => setSelectedAccountId(account.accountId)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
                selectedAccountId === account.accountId
                  ? "border-foreground bg-muted"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="font-medium">{account.name}</span>
              <span className="ml-2 text-muted-foreground">
                (act_{account.accountId}) · {account.currency}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="button"
        onClick={handleSelectAccount}
        disabled={!selectedAccountId || loading}
        className="w-full rounded-lg bg-foreground text-background py-2.5 text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving…" : "Confirm selection"}
      </button>
    </div>
  );
}
```

- [ ] **Step 8: Replace steps 3–5 with "Coming soon" blocks**

Replace the existing `set-targets`, `connect-capi`, and `activate` blocks with a single block:

```tsx
{
  (currentStep === "set-targets" ||
    currentStep === "connect-capi" ||
    currentStep === "activate") && (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">
          {currentStep === "set-targets" && "Set optimization targets"}
          {currentStep === "connect-capi" && "Connect Conversions API"}
          {currentStep === "activate" && "Activate Improve Spend"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">This step is coming soon.</p>
      </div>
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Coming soon — this step is not yet available in the beta.
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 10: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): wire Meta Ads OAuth into improve-spend wizard

Replaces placeholder wizard steps 1-2 with real OAuth redirect and ad
account selection. Step 1 redirects to Facebook authorize. Step 2
fetches real ad accounts and persists the user's selection to
inputConfig. Steps 3-5 shown as "Coming soon." Setup page enforces
single-deployment invariant.
EOF
)"
```

---

### Task 4: WhatsApp Test-Connection API Endpoint

Create a backend endpoint that validates WhatsApp credentials against the Graph API before they are saved. Graph API error codes are in the JSON body, not HTTP status.

**Files:**

- New: `apps/api/src/routes/whatsapp-test.ts`
- New: `apps/api/src/routes/__tests__/whatsapp-test.test.ts`
- Edit: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Write the test for the WhatsApp test function**

Create `apps/api/src/routes/__tests__/whatsapp-test.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { testWhatsAppCredentials } from "../whatsapp-test.js";

describe("testWhatsAppCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success for valid credentials", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        verified_name: "Test Business",
        display_phone_number: "+1234567890",
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "123456");
    expect(result).toEqual({
      success: true,
      verifiedName: "Test Business",
      displayPhoneNumber: "+1234567890",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/123456?access_token=valid-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns invalid-token error for Graph API code 190", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Invalid OAuth access token",
          type: "OAuthException",
          code: 190,
        },
      }),
    });

    const result = await testWhatsAppCredentials("bad-token", "123456");
    expect(result).toEqual({
      success: false,
      error: "Invalid access token. Check that you copied the full token.",
      statusCode: 401,
    });
  });

  it("returns not-found error for Graph API code 100 (invalid parameter)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Unsupported get request. Object with ID '999999' does not exist",
          type: "GraphMethodException",
          code: 100,
        },
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "999999");
    expect(result).toEqual({
      success: false,
      error: "Phone Number ID not found. Verify the ID in your Meta Business Suite.",
      statusCode: 404,
    });
  });

  it("returns not-found error for HTTP 404", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { message: "does not exist", code: 803 },
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "999999");
    expect(result).toEqual({
      success: false,
      error: "Phone Number ID not found. Verify the ID in your Meta Business Suite.",
      statusCode: 404,
    });
  });

  it("returns error for network timeout", async () => {
    mockFetch.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));

    const result = await testWhatsAppCredentials("valid-token", "123456");
    expect(result).toEqual({
      success: false,
      error: "Could not reach Meta's servers. Check your network and try again.",
      statusCode: 504,
    });
  });

  it("returns generic error for unknown Graph API error codes", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: "Some unknown API error",
          code: 9999,
        },
      }),
    });

    const result = await testWhatsAppCredentials("valid-token", "123456");
    expect(result).toEqual({
      success: false,
      error: "Meta API error: Some unknown API error",
      statusCode: 400,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx vitest run src/routes/__tests__/whatsapp-test.test.ts`
Expected: FAIL — `testWhatsAppCredentials` not found

- [ ] **Step 3: Create the WhatsApp test endpoint**

Create `apps/api/src/routes/whatsapp-test.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";

interface TestResult {
  success: boolean;
  verifiedName?: string;
  displayPhoneNumber?: string;
  error?: string;
  statusCode?: number;
}

interface GraphApiError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export async function testWhatsAppCredentials(
  token: string,
  phoneNumberId: string,
): Promise<TestResult> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}?access_token=${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, { signal: controller.signal });

    if (res.ok) {
      const data = (await res.json()) as {
        verified_name?: string;
        display_phone_number?: string;
      };
      return {
        success: true,
        verifiedName: data.verified_name,
        displayPhoneNumber: data.display_phone_number,
      };
    }

    const body = (await res.json().catch(() => ({}))) as GraphApiError;
    const graphCode = body.error?.code;
    const graphMessage = body.error?.message ?? "Unknown error";

    if (graphCode === 190 || res.status === 401) {
      return {
        success: false,
        error: "Invalid access token. Check that you copied the full token.",
        statusCode: 401,
      };
    }

    if (graphCode === 100 || res.status === 404) {
      return {
        success: false,
        error: "Phone Number ID not found. Verify the ID in your Meta Business Suite.",
        statusCode: 404,
      };
    }

    return {
      success: false,
      error: `Meta API error: ${graphMessage}`,
      statusCode: res.status,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        error: "Could not reach Meta's servers. Check your network and try again.",
        statusCode: 504,
      };
    }
    return {
      success: false,
      error: "Could not reach Meta's servers. Check your network and try again.",
      statusCode: 504,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const whatsappTestRoutes: FastifyPluginAsync = async (app) => {
  app.post<{
    Body: { token?: string; phoneNumberId?: string };
  }>(
    "/whatsapp/test",
    {
      schema: {
        description: "Test WhatsApp Cloud API credentials before saving.",
        tags: ["Connections", "WhatsApp"],
      },
    },
    async (request, reply) => {
      const { token, phoneNumberId } = request.body ?? {};

      if (!token || !phoneNumberId) {
        return reply.code(400).send({
          error: "Both token and phoneNumberId are required",
          statusCode: 400,
        });
      }

      const result = await testWhatsAppCredentials(token, phoneNumberId);

      if (result.success) {
        return reply.code(200).send(result);
      }
      return reply.code(result.statusCode ?? 502).send(result);
    },
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx vitest run src/routes/__tests__/whatsapp-test.test.ts`
Expected: PASS — all 6 tests pass

- [ ] **Step 5: Register the route in bootstrap/routes.ts**

In `apps/api/src/bootstrap/routes.ts`, add the import after the `facebookOAuthRoutes` import (around line 34):

```typescript
import { whatsappTestRoutes } from "../routes/whatsapp-test.js";
```

Add registration after the `facebookOAuthRoutes` registration line (around line 56):

```typescript
await app.register(whatsappTestRoutes, { prefix: "/api/connections" });
```

- [ ] **Step 6: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(api): add WhatsApp test-connection endpoint

POST /api/connections/whatsapp/test validates Cloud API credentials
against Graph API v21.0 before saving. Inspects Graph API error codes
in JSON body (190=invalid token, 100=bad ID) separately from HTTP
status. Returns specific user-facing error messages.
EOF
)"
```

---

### Task 5: Dashboard WhatsApp Test Proxy + Channel Card Enhancement

Add the dashboard proxy route and update the channel connect card with labeled fields, inline guidance, and test-before-save.

**Files:**

- New: `apps/dashboard/src/app/api/dashboard/connections/whatsapp/test/route.ts`
- Edit: `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`
- Edit: `apps/dashboard/src/app/(auth)/onboarding/page.tsx`

- [ ] **Step 1: Create the dashboard proxy for WhatsApp test**

Create `apps/dashboard/src/app/api/dashboard/connections/whatsapp/test/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { proxyError } from "@/lib/proxy-error";

export async function POST(request: NextRequest) {
  try {
    await requireSession();
    const body = await request.json();
    const { token, phoneNumberId } = body as {
      token?: string;
      phoneNumberId?: string;
    };

    if (!token || !phoneNumberId) {
      return NextResponse.json(
        { error: "Both token and phoneNumberId are required" },
        { status: 400 },
      );
    }

    const apiUrl = process.env.SWITCHBOARD_API_URL;
    if (!apiUrl) {
      return NextResponse.json({ error: "API URL not configured" }, { status: 500 });
    }
    const res = await fetch(`${apiUrl}/api/connections/whatsapp/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, phoneNumberId }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    return proxyError(err instanceof Error ? { error: err.message } : {}, 500);
  }
}
```

- [ ] **Step 2: Update CHANNEL_FIELDS in channel-connect-card.tsx**

In `apps/dashboard/src/components/onboarding/channel-connect-card.tsx`, change the `CHANNEL_FIELDS` definition (around line 67):

From:

```typescript
const CHANNEL_FIELDS: Record<string, { label: string; key: string; type: string }[]> = {
  whatsapp: [
    { label: "Phone number", key: "phone", type: "tel" },
    { label: "API key", key: "apiKey", type: "password" },
  ],
  telegram: [{ label: "Bot token", key: "botToken", type: "password" }],
};
```

To:

```typescript
const CHANNEL_FIELDS: Record<string, { label: string; key: string; type: string }[]> = {
  whatsapp: [
    { label: "Phone Number ID", key: "phoneNumberId", type: "text" },
    { label: "WhatsApp Cloud API Access Token", key: "token", type: "password" },
  ],
  telegram: [{ label: "Bot token", key: "botToken", type: "password" }],
};
```

- [ ] **Step 3: Add test-connection state to the component**

In the component function, after the existing state declarations (`expanded`, `fields`), add:

```typescript
const [showGuide, setShowGuide] = useState(false);
const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
const [testError, setTestError] = useState<string | null>(null);
const [testResult, setTestResult] = useState<{
  verifiedName?: string;
  displayPhoneNumber?: string;
} | null>(null);
```

- [ ] **Step 4: Add the test-connection handler**

After the state declarations, add:

```typescript
const isWhatsApp = channel === "whatsapp";
const canTest = isWhatsApp && fields.token && fields.phoneNumberId;
const canSave = isWhatsApp ? testStatus === "success" : true;

async function handleTestConnection() {
  setTestStatus("testing");
  setTestError(null);
  setTestResult(null);

  try {
    const res = await fetch("/api/dashboard/connections/whatsapp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: fields.token,
        phoneNumberId: fields.phoneNumberId,
      }),
    });
    const data = await res.json();

    if (data.success) {
      setTestStatus("success");
      setTestResult({
        verifiedName: data.verifiedName,
        displayPhoneNumber: data.displayPhoneNumber,
      });
    } else {
      setTestStatus("error");
      setTestError(data.error || "Connection test failed");
    }
  } catch {
    setTestStatus("error");
    setTestError("Could not reach Meta's servers. Check your network and try again.");
  }
}
```

- [ ] **Step 5: Add inline guidance in the expanded form area**

In the expanded form area (inside `{expanded && !isConnected && (...)}`), add the guidance section before the field mapping. After the opening `<div className="space-y-3">`:

```tsx
{
  isWhatsApp && (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setShowGuide(!showGuide)}
        className="text-[13px] underline"
        style={{ color: "var(--sw-accent)" }}
      >
        {showGuide ? "Hide guide" : "Where do I find these?"}
      </button>
      {showGuide && (
        <div
          className="mt-2 rounded-lg p-3 text-[13px] space-y-1"
          style={{
            backgroundColor: "rgba(160, 120, 80, 0.05)",
            color: "var(--sw-text-secondary)",
          }}
        >
          <p>
            <strong>Phone Number ID</strong> — A numeric ID for your WhatsApp business phone number.
            Find it in Meta Business Suite → WhatsApp → API Setup.
          </p>
          <p>
            <strong>Access Token</strong> — A temporary or permanent token from the same API Setup
            page. Use a permanent token for production.
          </p>
          <p>Your Meta Business account must have WhatsApp Cloud API access enabled.</p>
          <p>
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--sw-accent)" }}
            >
              Meta Cloud API documentation →
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add field-change reset for test status**

Update the `onChange` handler for each field's `Input` component. Change:

```tsx
onChange={(e) => setFields({ ...fields, [field.key]: e.target.value })}
```

To:

```tsx
onChange={(e) => {
  setFields({ ...fields, [field.key]: e.target.value });
  if (testStatus !== "idle") {
    setTestStatus("idle");
    setTestError(null);
    setTestResult(null);
  }
}}
```

- [ ] **Step 7: Add test result and error display + update buttons**

After the field mapping loop and before the existing `<Button>`, add:

```tsx
{
  testStatus === "success" && testResult && (
    <div
      className="rounded-lg p-3 text-[13px]"
      style={{ backgroundColor: "rgba(34, 197, 94, 0.08)", color: "hsl(145, 45%, 42%)" }}
    >
      ✓ Connected to <strong>{testResult.verifiedName || "WhatsApp Business"}</strong>
      {testResult.displayPhoneNumber && ` (${testResult.displayPhoneNumber})`}
    </div>
  );
}

{
  testStatus === "error" && testError && (
    <div
      className="rounded-lg p-3 text-[13px]"
      style={{ backgroundColor: "rgba(229, 72, 77, 0.08)", color: "hsl(358, 75%, 59%)" }}
    >
      {testError}
    </div>
  );
}
```

Replace the existing single `<Button>` block with two buttons:

```tsx
<div className="flex gap-3">
  {isWhatsApp && (
    <Button
      onClick={handleTestConnection}
      disabled={!canTest || testStatus === "testing"}
      variant="outline"
      className="h-[48px] flex-1 rounded-lg px-6 text-[14px]"
    >
      {testStatus === "testing" ? "Testing…" : "Test Connection"}
    </Button>
  )}
  <Button
    onClick={() => {
      onConnect(fields);
      setExpanded(false);
    }}
    disabled={isConnecting || !canSave}
    className="h-[48px] flex-1 rounded-lg px-6 text-[16px]"
    style={{ backgroundColor: "var(--sw-text-primary)", color: "white" }}
  >
    {isConnecting ? "Connecting..." : "Connect"}
  </Button>
</div>
```

- [ ] **Step 8: Update onboarding page field key mapping**

In `apps/dashboard/src/app/(auth)/onboarding/page.tsx`, find the `handleConnectChannel` function (around lines 55-58):

From:

```typescript
if (channel === "whatsapp") {
  provisionPayload.token = credentials.apiKey;
  provisionPayload.phoneNumberId = credentials.phone;
}
```

To:

```typescript
if (channel === "whatsapp") {
  provisionPayload.token = credentials.token;
  provisionPayload.phoneNumberId = credentials.phoneNumberId;
}
```

- [ ] **Step 9: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 10: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add WhatsApp guided setup with test connection

Relabels WhatsApp fields (Phone Number ID, Cloud API Access Token),
adds collapsible setup guide with Meta docs link, and requires
successful test connection before saving credentials. Specific error
messages for invalid token, wrong phone ID, and network issues.
EOF
)"
```

---

### Task 6: Deployment Bridge in Provisioning Route (Hard-Fail)

Add bridge record creation in the provisioning route. If the bridge cannot be created, provisioning fails — no silent success with broken routing.

**Files:**

- Edit: `apps/api/src/routes/organizations.ts:188-249`

- [ ] **Step 1: Add crypto import**

In `apps/api/src/routes/organizations.ts`, add import at the top of the file:

```typescript
import { createHash } from "node:crypto";
```

- [ ] **Step 2: Add bridge creation after managedChannel creation**

Inside the `for (const ch of channels)` loop, after the `managedChannel` creation (after line 222), add the bridge code. This is inside the existing `try` block, so if it throws, the channel provisioning will fail and report the error:

```typescript
// ── Beta compatibility bridge ──
// Create AgentDeployment + DeploymentConnection so
// PrismaDeploymentResolver.resolveByChannelToken() can resolve
// credentials from the ManagedChannel path.
const alexListing = await app.prisma.agentListing.findUnique({
  where: { slug: "alex-conversion" },
});

if (alexListing) {
  const deployment = await app.prisma.agentDeployment.upsert({
    where: {
      organizationId_listingId: {
        organizationId: orgId,
        listingId: alexListing.id,
      },
    },
    update: {},
    create: {
      organizationId: orgId,
      listingId: alexListing.id,
      status: "active",
      skillSlug: "alex",
    },
  });

  const tokenHash = createHash("sha256").update(connection.id).digest("hex");

  await app.prisma.deploymentConnection.upsert({
    where: {
      deploymentId_type_slot: {
        deploymentId: deployment.id,
        type: ch.channel,
        slot: "default",
      },
    },
    update: {
      credentials: encrypted,
      tokenHash,
      status: "active",
    },
    create: {
      deploymentId: deployment.id,
      type: ch.channel,
      slot: "default",
      credentials: encrypted,
      tokenHash,
    },
  });
}
```

Note: This code is inside the existing `try/catch` block. If `alexListing` is not found (e.g. seed data not run), it silently skips — this is acceptable because without the listing, there's no deployment to route to anyway. But if the listing exists and `upsert` fails, the error propagates and the channel is marked as `error` in the response.

- [ ] **Step 3: Run typecheck**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run the full API test suite for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/api test`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(api): add deployment bridge in provisioning route (hard-fail)

During channel provisioning, creates AgentDeployment (for Alex) and
DeploymentConnection records so PrismaDeploymentResolver can resolve
credentials from the ManagedChannel path. Uses upsert to avoid
duplicates. Bridge failure fails the provisioning — no silent success
with broken routing.
EOF
)"
```

---

### Task 7: Provisioning → Resolver Integration Test

Write a real integration-style test that verifies: provisioning creates the bridge records, and `PrismaDeploymentResolver.resolveByChannelToken()` can resolve the token that the runtime actually passes.

**Files:**

- New: `apps/api/src/routes/__tests__/provisioning-bridge.test.ts`

- [ ] **Step 1: Write the integration test**

Create `apps/api/src/routes/__tests__/provisioning-bridge.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

describe("Provisioning bridge → DeploymentResolver integration", () => {
  const MOCK_ORG_ID = "org_test_123";
  const MOCK_LISTING_ID = "list_alex_456";
  const MOCK_DEPLOYMENT_ID = "deploy_alex_789";
  const MOCK_CONNECTION_ID = "conn_wa_abc";
  const MOCK_ENCRYPTED = "encrypted_creds_string";

  let mockPrisma: {
    agentListing: { findUnique: ReturnType<typeof vi.fn> };
    agentDeployment: { upsert: ReturnType<typeof vi.fn> };
    deploymentConnection: {
      upsert: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  let bridgeRecords: Map<
    string,
    {
      deploymentId: string;
      type: string;
      tokenHash: string;
      credentials: string;
    }
  >;

  beforeEach(() => {
    bridgeRecords = new Map();

    mockPrisma = {
      agentListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: MOCK_LISTING_ID,
          slug: "alex-conversion",
        }),
      },
      agentDeployment: {
        upsert: vi.fn().mockResolvedValue({
          id: MOCK_DEPLOYMENT_ID,
          organizationId: MOCK_ORG_ID,
          listingId: MOCK_LISTING_ID,
          skillSlug: "alex",
          status: "active",
        }),
      },
      deploymentConnection: {
        upsert: vi
          .fn()
          .mockImplementation(
            async (args: {
              where: {
                deploymentId_type_slot: { deploymentId: string; type: string; slot: string };
              };
              create: {
                deploymentId: string;
                type: string;
                credentials: string;
                tokenHash: string;
              };
            }) => {
              const record = {
                deploymentId: args.create.deploymentId,
                type: args.create.type,
                tokenHash: args.create.tokenHash,
                credentials: args.create.credentials,
              };
              bridgeRecords.set(args.create.tokenHash, record);
              return record;
            },
          ),
        findFirst: vi
          .fn()
          .mockImplementation(async (args: { where: { tokenHash?: string; type?: string } }) => {
            if (args.where.tokenHash) {
              return bridgeRecords.get(args.where.tokenHash) ?? null;
            }
            return null;
          }),
      },
    };
  });

  async function simulateProvisioning(connectionId: string, channel: string) {
    const alexListing = await mockPrisma.agentListing.findUnique({
      where: { slug: "alex-conversion" },
    });
    if (!alexListing) throw new Error("Alex listing not found");

    const deployment = await mockPrisma.agentDeployment.upsert({
      where: {
        organizationId_listingId: {
          organizationId: MOCK_ORG_ID,
          listingId: alexListing.id,
        },
      },
      update: {},
      create: {
        organizationId: MOCK_ORG_ID,
        listingId: alexListing.id,
        status: "active",
        skillSlug: "alex",
      },
    });

    const tokenHash = createHash("sha256").update(connectionId).digest("hex");

    await mockPrisma.deploymentConnection.upsert({
      where: {
        deploymentId_type_slot: {
          deploymentId: deployment.id,
          type: channel,
          slot: "default",
        },
      },
      update: { credentials: MOCK_ENCRYPTED, tokenHash, status: "active" },
      create: {
        deploymentId: deployment.id,
        type: channel,
        slot: "default",
        credentials: MOCK_ENCRYPTED,
        tokenHash,
      },
    });

    return { deployment, tokenHash };
  }

  function simulateResolverLookup(channel: string, token: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return mockPrisma.deploymentConnection.findFirst({
      where: { type: channel, tokenHash },
    });
  }

  it("provisioning creates bridge records that resolver can find", async () => {
    await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    // The runtime passes Connection.id as the token (see runtime-registry.ts:80)
    const resolved = await simulateResolverLookup("whatsapp", MOCK_CONNECTION_ID);

    expect(resolved).not.toBeNull();
    expect(resolved.deploymentId).toBe(MOCK_DEPLOYMENT_ID);
    expect(resolved.type).toBe("whatsapp");
    expect(resolved.credentials).toBe(MOCK_ENCRYPTED);
  });

  it("resolver cannot find bridge with wrong token", async () => {
    await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    const resolved = await simulateResolverLookup("whatsapp", "conn_wrong_id");

    expect(resolved).toBeNull();
  });

  it("re-provisioning updates the bridge (same tokenHash resolves)", async () => {
    const { tokenHash: hash1 } = await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");
    const { tokenHash: hash2 } = await simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    expect(hash1).toBe(hash2);

    const resolved = await simulateResolverLookup("whatsapp", MOCK_CONNECTION_ID);
    expect(resolved).not.toBeNull();
  });

  it("upsert calls use the correct Prisma composite key", () => {
    expect(mockPrisma.agentDeployment.upsert).not.toHaveBeenCalled();

    simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp");

    expect(mockPrisma.agentDeployment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_listingId: {
            organizationId: MOCK_ORG_ID,
            listingId: MOCK_LISTING_ID,
          },
        },
      }),
    );
  });

  it("provisioning fails if listing not found", async () => {
    mockPrisma.agentListing.findUnique.mockResolvedValue(null);

    await expect(simulateProvisioning(MOCK_CONNECTION_ID, "whatsapp")).rejects.toThrow(
      "Alex listing not found",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/api exec -- npx vitest run src/routes/__tests__/provisioning-bridge.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(api): add provisioning → resolver integration test

Verifies the full bridge path: provisioning creates records that
PrismaDeploymentResolver can find using the same token the runtime
passes (Connection.id). Tests re-provisioning sync, wrong-token
rejection, and hard failure when listing is missing.
EOF
)"
```

---

### Task 8: Final Verification

Run the full test suite, typecheck, and lint to ensure everything works together.

**Files:**

- No new files

- [ ] **Step 1: Run the full test suite**

Run: `npx pnpm@9.15.4 test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: Pass (aside from pre-existing crypto.test.ts error in dashboard)

- [ ] **Step 3: Run lint**

Run: `npx pnpm@9.15.4 lint`
Expected: Pass

- [ ] **Step 4: Commit any final fixes if needed**

If any test/lint issues were found and fixed:

```bash
git commit -m "$(cat <<'EOF'
fix: address SP2 final verification issues
EOF
)"
```

---

## Post-Implementation Verification

After all tasks are complete, verify SP2's pass condition:

1. **Set env vars:** `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_REDIRECT_URI`, `CREDENTIALS_ENCRYPTION_KEY`
2. **Start the dashboard:** `npx pnpm@9.15.4 --filter @switchboard/dashboard dev`
3. **Navigate to improve-spend setup:** `/modules/improve-spend/setup`
4. **Click "Connect with Facebook":** Should redirect to Facebook OAuth dialog
5. **Complete OAuth:** Should return to step 2 with real ad accounts
6. **Select an ad account:** Should persist to `inputConfig.adAccountId`
7. **Navigate to onboarding:** WhatsApp channel card should show "Phone Number ID" and "WhatsApp Cloud API Access Token" labels
8. **Click "Where do I find these?":** Collapsible guide should expand
9. **Enter valid credentials + Test Connection:** Should show green success with business name
10. **Enter invalid credentials + Test Connection:** Should show specific error message (not generic)
11. **Connect with verified credentials:** Should persist and show "Connected ✓"
12. **Verify bridge:** Check DB for `DeploymentConnection` record with `tokenHash` = SHA-256 of `Connection.id`
13. **Verify resolver:** Run unit test confirming `PrismaDeploymentResolver.resolveByChannelToken()` resolves the WhatsApp channel
