# Service-Specific Connection Forms + Wizard Ad Platform Step

**Date:** 2026-03-28
**Status:** Approved

## Problem

The connections form uses a generic key/value credential input. Customers adding Meta Ads need to enter 3 credentials (access token, account ID, pixel ID) but the form only supports one unlabeled key-value pair. Additionally, the onboarding wizard has no step for ad platform setup, so customers who purchase the Ad Optimizer agent have no guided path to connect their Meta Ads account.

## Solution

### 1. Service-Specific Field Configs

A `SERVICE_FIELD_CONFIGS` map defines per-service credential fields with labels, types, placeholders, and help text. Shared from `apps/dashboard/src/lib/service-field-configs.ts`.

```ts
type ServiceFieldConfig = {
  key: string;
  label: string;
  type: "text" | "password";
  required: boolean;
  placeholder: string;
  helpText?: string;
};

const SERVICE_FIELD_CONFIGS: Record<string, ServiceFieldConfig[]> = {
  "meta-ads": [
    {
      key: "accessToken",
      label: "Access Token",
      type: "password",
      required: true,
      placeholder: "System User token from Meta Business Suite",
      helpText: "Go to Business Settings > System Users > Generate Token",
    },
    {
      key: "accountId",
      label: "Ad Account ID",
      type: "text",
      required: true,
      placeholder: "act_123456789",
      helpText: "Found in Ads Manager > Account Overview",
    },
    {
      key: "pixelId",
      label: "Pixel ID",
      type: "text",
      required: false,
      placeholder: "123456789",
      helpText: "Found in Events Manager (optional)",
    },
  ],
};
```

Services without a config fall back to the existing generic key/value form.

### 2. Connections Form Update

`connections-list.tsx` checks `SERVICE_FIELD_CONFIGS[serviceId]` when a service is selected. If a config exists, it renders labeled `<Input>` fields for each credential. The form builds the `credentials` object from all field values: `{ accessToken: "...", accountId: "...", pixelId: "..." }`.

No backend changes — the connections API already stores arbitrary JSON credentials with encryption.

### 3. Wizard Ad Platform Step

A new `StepAdPlatform` component appears as step 5 in the onboarding wizard **only when** `ad-optimizer` is in `selectedAgents`. It imports field definitions from the shared `SERVICE_FIELD_CONFIGS`.

- Wizard step count: 6 (default) or 7 (when ad-optimizer selected)
- Step labels adjust dynamically: adds "Connect ads" between "Connect channels" and "Meet your team"
- Step is optional — `canProceed` is always `true`
- On wizard completion: if `accessToken` and `accountId` are both filled, creates a `meta-ads` connection via `POST /api/dashboard/connections`

### 4. Onboarding Page Changes

New state: `adCredentials: Record<string, string>` (initially `{}`).

In `handleComplete`, after channel provisioning (step 4 in current flow):

```ts
if (adCredentials.accessToken && adCredentials.accountId) {
  const connRes = await fetch("/api/dashboard/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: "meta-ads",
      serviceName: "Meta Ads",
      authType: "api_key",
      credentials: adCredentials,
    }),
  });
  await assertOk(connRes, "Meta Ads connection");
}
```

## Files Changed

| File                                                            | Change                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `apps/dashboard/src/lib/service-field-configs.ts`               | **New** — shared `SERVICE_FIELD_CONFIGS` map                 |
| `apps/dashboard/src/components/settings/connections-list.tsx`   | Render labeled fields when config exists, generic fallback   |
| `apps/dashboard/src/components/onboarding/step-ad-platform.tsx` | **New** — wizard step for Meta Ads credentials               |
| `apps/dashboard/src/app/onboarding/page.tsx`                    | Conditional step, `adCredentials` state, connection creation |

## Out of Scope

- OAuth flow for Meta Ads (manual token paste is acceptable for v1)
- Google Ads, TikTok, Stripe field configs (add later when needed)
- Backend changes (none required)
- New tests (pure UI change, existing API tests cover credential storage)
