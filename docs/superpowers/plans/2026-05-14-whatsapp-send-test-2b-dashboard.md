# WhatsApp Send-Test (Slice 2B — Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Slice 2A backend PR is merged. The `POST /api/dashboard/whatsapp/send-test` and `GET /api/dashboard/whatsapp/test-sends` endpoints exist and are tested.

**Goal:** Dashboard surface for the send-test feature. Operator opens `/settings/channels/whatsapp`, sees a new "Send test" panel between Phone Numbers and Templates, picks an active phone + an APPROVED template + an allowlisted recipient, hits Send, and sees the returned `messageId` + progressive webhook status updates inline.

**Architecture:** New `whatsapp-send-test.tsx` component injected into the existing management page. React Query for the mutation + the recent-tests list (5s refetch interval; invalidates on send-success). No new visual register — uses the same shadcn primitives as the rest of the management page.

**Tech Stack:** Next.js 14 App Router, React Query, shadcn/ui, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-14-whatsapp-tech-provider-console-design.md` — Slice 2 (frontend half).

---

## Scope guardrails — do NOT add these

- ❌ Any backend changes beyond extending the existing `/account` response (Task 1 below).
- ❌ A UI to **edit** `testRecipients` (admin seeds via SQL; documented in Slice 2A PR body).
- ❌ Optimistic insertion of test rows in the cache (5s refetch is good enough and simpler).
- ❌ Modal-stacking — the panel is inline.
- ❌ Pricing / cost projection — out of scope for Slice 2.

## Codebase alignment notes

- Dashboard imports never use `.js` extensions (Next.js, per `feedback_dashboard_no_js_on_any_import.md`).
- Existing hooks live in `apps/dashboard/src/hooks/use-whatsapp-management.ts`. New hooks go in a sibling file `use-whatsapp-send-test.ts`.
- **Hook import path for `useScopedQueryKeys`**: import from `@/hooks/use-query-keys`, **not** from `@/lib/query-keys` (which only re-exports the keys factory, not the hook). Mirror `use-whatsapp-management.ts:4`: `import { useScopedQueryKeys } from "@/hooks/use-query-keys";`.
- Query keys factory lives in `apps/dashboard/src/lib/query-keys.ts` under `whatsappManagement`. Add `testSends` alongside `account/phoneNumbers/templates` there.
- `WhatsAppManagement` component composes child sections (Setup → PhoneNumbers → Templates). Inject `<WhatsAppSendTest />` between PhoneNumbers and Templates. The component early-returns on `readiness.status === "not_connected"`, so the injected panel is only rendered when there's a connected account.
- `pnpm --filter @switchboard/dashboard build` is **not in CI**. Must run locally before merge per `feedback_dashboard_build_not_in_ci.md`. Clear `.next/` first.

## File structure (Slice 2B only)

**Create:**

- `apps/dashboard/src/hooks/use-whatsapp-send-test.ts`
- `apps/dashboard/src/components/settings/whatsapp-send-test.tsx`
- `apps/dashboard/src/components/settings/__tests__/whatsapp-send-test.test.tsx`

**Modify:**

- `apps/api/src/routes/whatsapp-management.ts` — extend `/account` to include `connection.testRecipients`
- `apps/api/src/routes/__tests__/whatsapp-management.test.ts` — assert new field
- `apps/dashboard/src/hooks/use-whatsapp-management.ts` — extend the connection type
- `apps/dashboard/src/lib/query-keys.ts` — add `testSends` key
- `apps/dashboard/src/components/settings/whatsapp-management.tsx` — inject the panel

---

## Task 1 — Surface `testRecipients` on GET /account

**Files:**

- Modify: `apps/api/src/routes/whatsapp-management.ts`
- Modify: `apps/api/src/routes/__tests__/whatsapp-management.test.ts`
- Modify: `apps/dashboard/src/hooks/use-whatsapp-management.ts`

**Important context:** `/account` has FOUR return branches in `whatsapp-management.ts:175-249` — `not_connected`, `incomplete`, `needs_attention`, and `connected`. ALL four return a `connection` block (the `not_connected` branch returns `{ status: "not_connected", externalAccountId: null, primaryPhoneNumberId: null, connectedAt: null }`). Add `testRecipients` to the connection block in every branch uniformly. Don't try to be clever and omit it in `not_connected`.

**Test mock surface:** the existing `/account` tests in `apps/api/src/routes/__tests__/whatsapp-management.test.ts:17-22` decorate Prisma with only `{ connection: { findFirst: mockFindFirst } }`. Once the handler also calls `app.prisma!.managedChannel.findFirst(...)`, those tests will throw `Cannot read properties of undefined (reading 'findFirst')` before reaching assertions. **You must extend the shared test setup** with `managedChannel: { findFirst: mockManagedChannelFindFirst }` and provide a sensible default (`mockManagedChannelFindFirst.mockResolvedValue({ testRecipients: [] })`) in `beforeEach`, then override per-test where needed. Audit every existing `/account` test before changing the handler — green → red is silent in CI if the mock is missing.

- [ ] **Step 1a: Extend the shared test mock FIRST** (before changing the handler — keeps the existing 15 tests green).

In `apps/api/src/routes/__tests__/whatsapp-management.test.ts`, find the `beforeEach`/`beforeAll` decorating Prisma. Add `managedChannel: { findFirst: vi.fn() }`. In the per-test setup, default it: `mockManagedChannelFindFirst.mockResolvedValue({ testRecipients: [] })`. This default ensures every existing test still passes.

- [ ] **Step 1b: Failing API tests** — add three new tests covering distinct branches:

```typescript
it("connected: includes testRecipients on the connection block", async () => {
  // mock Connection: connected, externalAccountId="WABA_1"
  mockManagedChannelFindFirst.mockResolvedValueOnce({ testRecipients: ["+15551234567"] });
  // mock Graph templates + phones happy path
  const res = await app.inject({ method: "GET", url: "/account" });
  const body = res.json() as { connection: { testRecipients: string[] } };
  expect(body.connection.testRecipients).toEqual(["+15551234567"]);
});

it("not_connected: still surfaces empty testRecipients", async () => {
  mockFindFirst.mockResolvedValueOnce(null); // no Connection row
  mockManagedChannelFindFirst.mockResolvedValueOnce({ testRecipients: [] });
  const res = await app.inject({ method: "GET", url: "/account" });
  const body = res.json() as { connection: { status: string; testRecipients: string[] } };
  expect(body.connection.status).toBe("not_connected");
  expect(body.connection.testRecipients).toEqual([]);
});

it("incomplete: surfaces testRecipients alongside the incomplete status", async () => {
  // mock Connection without externalAccountId → triggers "incomplete" branch
  mockManagedChannelFindFirst.mockResolvedValueOnce({ testRecipients: ["+15551111111"] });
  const res = await app.inject({ method: "GET", url: "/account" });
  const body = res.json() as { connection: { status: string; testRecipients: string[] } };
  expect(body.connection.status).toBe("incomplete");
  expect(body.connection.testRecipients).toEqual(["+15551111111"]);
});
```

Optional: a fourth test for `needs_attention` if you want full branch coverage. The first three are enough to prove the threading.

- [ ] **Step 2: Modify the `/account` handler.** Load `ManagedChannel` once at the top of the handler (alongside the `Connection` lookup), parse `testRecipients` into a string array, and include it in the connection block of every return branch that has one:

```typescript
const channel = await app.prisma.managedChannel.findFirst({
  where: { organizationId: orgId, channel: "whatsapp" },
});
const testRecipients = Array.isArray(channel?.testRecipients)
  ? (channel.testRecipients as unknown[]).filter((x): x is string => typeof x === "string")
  : [];

// In each "connected"/"needs_attention"/"incomplete" branch's connection object:
connection: {
  // ...existing fields
  testRecipients,
}
// In the "not_connected" branch: either include `testRecipients: []` for consistency,
// or omit entirely (dashboard's send-test panel only renders when readiness !== "not_connected").
```

Touch all four branches; do not split this across PRs.

- [ ] **Step 3: Extend dashboard types** — in `apps/dashboard/src/hooks/use-whatsapp-management.ts:10-29`, the existing connection type's `status` union is `"connected" | "incomplete" | "needs_attention"` and is missing `"not_connected"` (the API actually returns that value at runtime). Fix both as part of this PR:

```typescript
// Add "not_connected" to the union AND add the new field.
status: "connected" | "incomplete" | "needs_attention" | "not_connected";
testRecipients: string[];
```

Since Task 1 now makes the handler emit `testRecipients` in all four branches, the type is **required**, not optional. In the panel-injection code (Task 4 of this plan), `account.data.connection.testRecipients` is safe to read directly.

- [ ] **Step 4: Run, pass**

```bash
pnpm --filter @switchboard/api test -- whatsapp-management
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/whatsapp-management.ts \
        apps/api/src/routes/__tests__/whatsapp-management.test.ts \
        apps/dashboard/src/hooks/use-whatsapp-management.ts
git commit -m "feat(api,dashboard): /account exposes connection.testRecipients allowlist (slice 2b)"
```

---

## Task 2 — Query keys + hooks

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts`
- Create: `apps/dashboard/src/hooks/use-whatsapp-send-test.ts`

- [ ] **Step 1: Add `testSends` key** in `query-keys.ts`:

```typescript
whatsappManagement: {
  all: () => [orgId, "whatsappManagement"] as const,
  account: () => [orgId, "whatsappManagement", "account"] as const,
  phoneNumbers: () => [orgId, "whatsappManagement", "phoneNumbers"] as const,
  templates: () => [orgId, "whatsappManagement", "templates"] as const,
  testSends: () => [orgId, "whatsappManagement", "testSends"] as const,
},
```

- [ ] **Step 2: Create the hooks file** (no `.js` extensions in dashboard imports; `useScopedQueryKeys` comes from the `hooks` path):

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";

export interface SendTestRequest {
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
}

export interface SendTestResult {
  messageId: string;
  status: "sent" | "failed";
  sentAt: string;
}

export interface TestSendRow {
  id: string;
  messageId: string;
  phoneNumberId: string;
  templateName: string;
  languageCode: string;
  toNumber: string;
  sentBy: string;
  sentAt: string;
  apiStatus: "sent" | "failed";
  lastWebhookStatus: "sent" | "delivered" | "read" | "failed" | null;
  lastWebhookAt: string | null;
}

interface ApiError {
  error: { code: string; message: string; retryable: boolean };
}

async function postSendTest(body: SendTestRequest): Promise<SendTestResult> {
  const res = await fetch("/api/dashboard/whatsapp/send-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(err.error?.message ?? `Send-test failed (${res.status})`);
  }
  return (await res.json()) as SendTestResult;
}

async function fetchTestSends(): Promise<TestSendRow[]> {
  const res = await fetch("/api/dashboard/whatsapp/test-sends");
  if (!res.ok) throw new Error(`Failed to load recent tests (${res.status})`);
  const body = (await res.json()) as { tests: TestSendRow[] };
  return body.tests;
}

export function useSendWhatsAppTest() {
  const keys = useScopedQueryKeys();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postSendTest,
    onSuccess: () => {
      if (keys) qc.invalidateQueries({ queryKey: keys.whatsappManagement.testSends() });
    },
  });
}

export function useWhatsAppRecentTests(enabled = true) {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.whatsappManagement.testSends() ?? ["unscoped", "testSends"],
    queryFn: fetchTestSends,
    enabled: enabled && !!keys,
    refetchInterval: 5000,
    staleTime: 1000,
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
rm -rf apps/dashboard/.next
pnpm --filter @switchboard/dashboard typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/hooks/use-whatsapp-send-test.ts
git commit -m "feat(dashboard): send-test query keys + useSendWhatsAppTest / useWhatsAppRecentTests hooks"
```

---

## Task 3 — WhatsAppSendTest component

**Files:**

- Create: `apps/dashboard/src/components/settings/whatsapp-send-test.tsx`
- Create: `apps/dashboard/src/components/settings/__tests__/whatsapp-send-test.test.tsx`

- [ ] **Step 1: Failing component tests**

Mock the hooks and assert:

- Renders a heading "Send test" and a Submit button.
- Submit button is disabled when there are zero APPROVED templates.
- Submit button is disabled when `allowedRecipients` is empty AND a hint "Add a test recipient to this channel..." is visible.

- [ ] **Step 2: Implement** — create `apps/dashboard/src/components/settings/whatsapp-send-test.tsx`:

```typescript
"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import {
  useSendWhatsAppTest,
  useWhatsAppRecentTests,
  type TestSendRow,
} from "@/hooks/use-whatsapp-send-test";

export interface SendTestPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string;
}

export interface SendTestTemplate {
  name: string;
  status: string;
  language: string;
}

interface Props {
  phoneNumbers: SendTestPhoneNumber[];
  templates: SendTestTemplate[];
  allowedRecipients: string[];
}

const DELIVERED_STATES = new Set(["delivered", "read"]);

function StatusCell({ row }: { row: TestSendRow }) {
  // Show "Accepted by WhatsApp · awaiting delivery webhook" until first webhook arrives.
  if (row.lastWebhookStatus === null && row.apiStatus === "sent") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Badge className="bg-amber-100 text-amber-800">accepted</Badge>
        <span>awaiting delivery webhook</span>
      </span>
    );
  }
  if (row.apiStatus === "failed") {
    return <Badge className="bg-red-100 text-red-800">failed</Badge>;
  }
  const label = row.lastWebhookStatus ?? row.apiStatus;
  const tone =
    label === "failed"
      ? "bg-red-100 text-red-800"
      : DELIVERED_STATES.has(label)
        ? "bg-green-100 text-green-800"
        : "bg-amber-100 text-amber-800";
  return (
    <span className="inline-flex items-center gap-1.5">
      {DELIVERED_STATES.has(label) && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
      <Badge className={tone}>{label}</Badge>
    </span>
  );
}

export function WhatsAppSendTest({ phoneNumbers, templates, allowedRecipients }: Props) {
  const activeNumbers = useMemo(
    () => phoneNumbers.filter((p) => p.status === "active"),
    [phoneNumbers],
  );
  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status.toUpperCase() === "APPROVED"),
    [templates],
  );

  const [phoneNumberId, setPhoneNumberId] = useState(activeNumbers[0]?.id ?? "");
  const [templateName, setTemplateName] = useState(approvedTemplates[0]?.name ?? "");
  const [languageCode, setLanguageCode] = useState(approvedTemplates[0]?.language ?? "en_US");
  const [toNumber, setToNumber] = useState(allowedRecipients[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const send = useSendWhatsAppTest();
  const recent = useWhatsAppRecentTests();

  const disabled =
    !phoneNumberId ||
    !templateName ||
    !toNumber ||
    approvedTemplates.length === 0 ||
    allowedRecipients.length === 0 ||
    send.isPending;

  async function onSubmit() {
    setError(null);
    try {
      const tpl = approvedTemplates.find((t) => t.name === templateName);
      await send.mutateAsync({
        phoneNumberId,
        templateName,
        languageCode: tpl?.language ?? languageCode,
        toNumber,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Send test</CardTitle>
        <p className="text-sm text-muted-foreground">
          Send an approved template to an allowlisted recipient. Meta accepts immediately; delivery
          and read receipts arrive via webhook.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">From phone</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            >
              {activeNumbers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayPhoneNumber ?? p.id} — {p.verifiedName ?? "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Template (approved only)</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={templateName}
              onChange={(e) => {
                const next = e.target.value;
                setTemplateName(next);
                const tpl = approvedTemplates.find((t) => t.name === next);
                if (tpl) setLanguageCode(tpl.language);
              }}
            >
              {approvedTemplates.length === 0 ? (
                <option value="">No approved templates</option>
              ) : (
                approvedTemplates.map((t) => (
                  <option key={`${t.name}:${t.language}`} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-muted-foreground">Test recipient (allowlist)</span>
            <select
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
            >
              {allowedRecipients.length === 0 ? (
                <option value="">No allowlisted numbers</option>
              ) : (
                allowedRecipients.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        {allowedRecipients.length === 0 && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertCircle className="h-4 w-4" />
            Add a test recipient to this channel before send-test can be used.
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <div>
          <Button onClick={onSubmit} disabled={disabled}>
            {send.isPending ? "Sending…" : "Send test"}
          </Button>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Recent tests</h3>
          {recent.isLoading && (
            <p className="text-sm text-muted-foreground">Loading recent tests…</p>
          )}
          {recent.error && (
            <p className="text-sm text-destructive">Failed to load recent tests.</p>
          )}
          {recent.data && recent.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No tests sent yet.</p>
          )}
          {recent.data && recent.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Template</th>
                    <th className="pb-2 pr-4 font-medium">To</th>
                    <th className="pb-2 pr-4 font-medium">Sent</th>
                    <th className="pb-2 pr-4 font-medium">Message ID</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{row.templateName}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{row.toNumber}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(row.sentAt).toLocaleTimeString()}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[10px] text-muted-foreground">
                        {row.messageId.slice(0, 10)}…{row.messageId.slice(-4)}
                      </td>
                      <td className="py-2">
                        <StatusCell row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Run, pass, commit**

```bash
cd apps/dashboard && pnpm exec vitest run src/components/settings/__tests__/whatsapp-send-test
git add apps/dashboard/src/components/settings/whatsapp-send-test.tsx \
        apps/dashboard/src/components/settings/__tests__/whatsapp-send-test.test.tsx
git commit -m "feat(dashboard): WhatsAppSendTest panel — form + recent tests with accepted/delivered states"
```

---

## Task 4 — Inject the panel into WhatsAppManagement

**File:** `apps/dashboard/src/components/settings/whatsapp-management.tsx`

- [ ] **Step 1: Import + inject between Phone Numbers and Templates**

Add to imports:

```typescript
import { WhatsAppSendTest } from "./whatsapp-send-test";
```

Inside `WhatsAppManagement()`'s return JSX, between `<PhoneNumbersSection />` and `<TemplatesSection />`:

```tsx
<WhatsAppSendTest
  phoneNumbers={phones.data?.phoneNumbers ?? []}
  templates={templates.data?.templates ?? []}
  allowedRecipients={account.data.connection.testRecipients ?? []}
/>
```

- [ ] **Step 2: Typecheck + build**

```bash
rm -rf apps/dashboard/.next
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard build
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(dashboard): inject WhatsAppSendTest between Phone Numbers and Templates"
```

---

## Task 5 — End-to-end verification + manual smoke

- [ ] **Step 1:** Full typecheck + test

```bash
pnpm typecheck
pnpm test
```

- [ ] **Step 2:** Dashboard build (regression check — not in CI)

```bash
rm -rf apps/dashboard/.next
pnpm --filter @switchboard/dashboard build
```

- [ ] **Step 3: Manual staging smoke** — seed the allowlist via SQL, navigate to `/settings/channels/whatsapp`, send a test, verify the recent-tests row appears with `accepted · awaiting delivery webhook` within 5s and progresses through `delivered` → `read` within ~30s.

- [ ] **Step 4: Open PR**

```bash
git push -u origin <branch-name>
gh pr create --base main \
  --title "feat(whatsapp): Slice 2B — dashboard send-test surface" \
  --body "<see PR body template — references Slice 2A, allowlist-via-SQL, App-Review screencast readiness>"
```

The PR body must state that after this PR + Slice 2A, the App Review screencast story runs end-to-end on `/settings/channels/whatsapp` covering both `whatsapp_business_management` and `whatsapp_business_messaging`.
