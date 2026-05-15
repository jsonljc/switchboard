# WhatsApp Send-Test (Slice 2B — Dashboard Surface + `/account` Allowlist Exposure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Slice 2A backend PR is merged. The `POST /api/dashboard/whatsapp/send-test` and `GET /api/dashboard/whatsapp/test-sends` endpoints exist and are tested.

**Goal:** Dashboard surface for the send-test feature. Operator opens `/settings/channels/whatsapp`, sees a new "Send test" panel between Phone Numbers and Templates, picks an active phone + an APPROVED template + an allowlisted recipient, hits Send, and sees an inline result — either the returned `messageId` (accepted by WhatsApp) or an error message.

**Architecture:** New `whatsapp-send-test.tsx` component injected into the existing management page. React Query for the send mutation; the mutation's `data` / `error` drive the inline result pane. No new visual register — uses the same shadcn primitives as the rest of the management page.

**Out of scope for 2B (may follow as a separate slice if delivery monitoring becomes a real need):** a persistent recent-tests history list, polling for webhook status, progressive status pills (sent → delivered → read). The `GET /test-sends` endpoint and webhook bridge from 2A still write the data — 2B just doesn't surface it.

**Tech Stack:** Next.js 14 App Router, React Query, shadcn/ui, Tailwind, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-14-whatsapp-tech-provider-console-design.md` — Slice 2 (frontend half).

---

## Scope guardrails — do NOT add these

- ❌ Any backend changes beyond extending the existing `/account` response (Task 1 below).
- ❌ A UI to **edit** `testRecipients` (admin seeds via SQL; documented in Slice 2A PR body).
- ❌ **Recent-tests history list / polling / status pills.** The send-test panel is a smoke-test surface, not a delivery-monitoring tool. The inline mutation result (success `messageId` or error message) is the entire result UX. If delivery monitoring becomes a real operator need, ship it as its own slice with its own design.
- ❌ Modal-stacking — the panel is inline.
- ❌ Pricing / cost projection — out of scope for Slice 2.

## Codebase alignment notes

- Dashboard imports never use `.js` extensions (Next.js, per `feedback_dashboard_no_js_on_any_import.md`).
- Existing hooks live in `apps/dashboard/src/hooks/use-whatsapp-management.ts`. New hooks go in a sibling file `use-whatsapp-send-test.ts`.
- **Hook import path for `useScopedQueryKeys`**: import from `@/hooks/use-query-keys`, **not** from `@/lib/query-keys` (which only re-exports the keys factory, not the hook). Mirror `use-whatsapp-management.ts:4`: `import { useScopedQueryKeys } from "@/hooks/use-query-keys";`.
- Query keys factory lives in `apps/dashboard/src/lib/query-keys.ts` under `whatsappManagement`. The trimmed 2B does not add a new key — the send mutation does not need cache invalidation since there is no list view to refresh.
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
// In the "not_connected" branch, include `testRecipients: []` (do NOT omit).
// The dashboard type is required (not optional), so every branch must emit
// the field. This keeps `account.data.connection.testRecipients` safe to read
// directly without `?? []` fallbacks.
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

## Task 2 — Send-test mutation hook

**Files:**

- Create: `apps/dashboard/src/hooks/use-whatsapp-send-test.ts`

The trimmed 2B does **not** add a query key or a recent-tests query hook — only the send mutation.

- [ ] **Step 1: Create the hooks file** (no `.js` extensions in dashboard imports):

```typescript
import { useMutation } from "@tanstack/react-query";

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

export function useSendWhatsAppTest() {
  return useMutation({ mutationFn: postSendTest });
}
```

- [ ] **Step 2: Typecheck**

```bash
rm -rf apps/dashboard/.next
pnpm --filter @switchboard/dashboard typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/use-whatsapp-send-test.ts
git commit -m "feat(dashboard): useSendWhatsAppTest mutation hook"
```

---

## Task 3 — WhatsAppSendTest component

**Files:**

- Create: `apps/dashboard/src/components/settings/whatsapp-send-test.tsx`
- Create: `apps/dashboard/src/components/settings/__tests__/whatsapp-send-test.test.tsx`

- [ ] **Step 1: Failing component tests**

Mock the `useSendWhatsAppTest` hook and assert:

- Renders a heading "Send test" and a Submit button.
- Submit button is disabled when there are zero APPROVED templates.
- Submit button is disabled when `allowedRecipients` is empty AND a hint "Add a test recipient to this channel..." is visible.
- After a successful send, an inline success pane appears with the returned `messageId`.
- After a failed send, an inline error pane appears with the error message.

- [ ] **Step 2: Implement** — create `apps/dashboard/src/components/settings/whatsapp-send-test.tsx`:

```typescript
"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useSendWhatsAppTest } from "@/hooks/use-whatsapp-send-test";

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
          Send an approved template to an allowlisted recipient to verify the integration is wired
          up correctly.
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

        {send.data && (
          <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
            <div className="space-y-0.5">
              <div>Accepted by WhatsApp.</div>
              <div className="font-mono text-xs text-green-800">
                messageId: {send.data.messageId}
              </div>
              <div className="text-xs text-green-700">
                Sent at {new Date(send.data.sentAt).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

The result pane reads `send.data` (last successful mutation result) and `error` (local state set in the catch block). No separate query, no polling, no persistence in the component. Sending again replaces `send.data` with the new result.

- [ ] **Step 3: Run, pass, commit**

```bash
cd apps/dashboard && pnpm exec vitest run src/components/settings/__tests__/whatsapp-send-test
git add apps/dashboard/src/components/settings/whatsapp-send-test.tsx \
        apps/dashboard/src/components/settings/__tests__/whatsapp-send-test.test.tsx
git commit -m "feat(dashboard): WhatsAppSendTest panel — form + inline accepted/error result"
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
  allowedRecipients={account.data.connection.testRecipients}
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

- [ ] **Step 3: Manual staging smoke** — seed the allowlist via SQL, navigate to `/settings/channels/whatsapp`, send a test. Verify the inline success pane appears within ~2s showing "Accepted by WhatsApp" + the returned `messageId`. Send a second test with a deliberately wrong template name to verify the inline error pane renders the upstream Graph error message.

- [ ] **Step 4: Open PR**

```bash
git push -u origin <branch-name>
gh pr create --base main \
  --title "feat(whatsapp): Slice 2B — dashboard surface + /account allowlist exposure" \
  --body "<see PR body template — references Slice 2A, allowlist-via-SQL, App-Review screencast readiness>"
```

The PR body must state that after this PR + Slice 2A, the App Review screencast story runs end-to-end on `/settings/channels/whatsapp` covering both `whatsapp_business_management` and `whatsapp_business_messaging`.
