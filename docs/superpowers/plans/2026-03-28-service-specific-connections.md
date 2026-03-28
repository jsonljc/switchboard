# Service-Specific Connection Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic key/value connection form with labeled, service-specific credential fields for Meta Ads, and add an optional "Connect ads" step to the onboarding wizard when the Ad Optimizer agent is selected.

**Architecture:** Config-driven approach — a shared `SERVICE_FIELD_CONFIGS` map defines per-service credential fields. Both the settings connections form and the wizard step import from the same config. No backend changes needed; the existing connections API stores arbitrary JSON credentials.

**Tech Stack:** Next.js (React), TypeScript, shadcn/ui components, TanStack Query (existing hooks)

**Spec:** `docs/superpowers/specs/2026-03-28-service-specific-connections-design.md`

**Important:** This is a Next.js dashboard app. Use **extensionless imports** (no `.js` extensions). All components are `"use client"`.

---

### Task 1: Create shared service field configs

**Files:**

- Create: `apps/dashboard/src/lib/service-field-configs.ts`

- [ ] **Step 1: Create the config file**

```ts
export interface ServiceFieldConfig {
  key: string;
  label: string;
  type: "text" | "password";
  required: boolean;
  placeholder: string;
  helpText?: string;
}

export const SERVICE_FIELD_CONFIGS: Record<string, ServiceFieldConfig[]> = {
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

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: Clean exit, no errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add service field configs for Meta Ads connections"
```

---

### Task 2: Update connections form with service-specific fields

**Files:**

- Modify: `apps/dashboard/src/components/settings/connections-list.tsx`

The form currently uses a single `credKey`/`credValue` state pair (lines 78-79) and renders a generic 2-column key/value input (lines 315-335). Replace this with a config-driven approach.

- [ ] **Step 1: Add import and new state**

At the top of the file, add the import after the existing imports (after line 30):

```ts
import { SERVICE_FIELD_CONFIGS } from "@/lib/service-field-configs";
```

Replace the credential state variables (lines 78-79):

```ts
const [credKey, setCredKey] = useState("");
const [credValue, setCredValue] = useState("");
```

With:

```ts
const [credFields, setCredFields] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Update handleCreate to use credFields**

Replace the `handleCreate` function (lines 86-104) with:

```ts
const handleCreate = (e: React.FormEvent) => {
  e.preventDefault();
  const fieldConfig = SERVICE_FIELD_CONFIGS[serviceId];
  const credentials: Record<string, unknown> = fieldConfig
    ? { ...credFields }
    : credFields["_key"] && credFields["_value"]
      ? { [credFields["_key"]]: credFields["_value"] }
      : {};
  createConnection.mutate(
    { serviceId, serviceName: serviceName || serviceId, authType, credentials },
    {
      onSuccess: () => {
        setFormOpen(false);
        setServiceId("");
        setServiceName("");
        setCredFields({});
      },
    },
  );
};
```

- [ ] **Step 3: Update service selection to reset credFields**

In the `Select` `onValueChange` handler (lines 270-274), add `setCredFields({})`:

```ts
onValueChange={(v) => {
  setServiceId(v);
  const svc = serviceOptions.find((s) => s.id === v);
  if (svc) setServiceName(svc.name);
  setCredFields({});
}}
```

- [ ] **Step 4: Replace the credential fields section**

Replace the generic key/value grid (lines 314-335 — the `<div className="grid grid-cols-2 gap-4">` block) with:

```tsx
{
  SERVICE_FIELD_CONFIGS[serviceId] ? (
    <div className="space-y-3">
      {SERVICE_FIELD_CONFIGS[serviceId].map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`cred-${field.key}`}>
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Input
            id={`cred-${field.key}`}
            type={field.type}
            value={credFields[field.key] ?? ""}
            onChange={(e) => setCredFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
          />
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        </div>
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <Label htmlFor="cred-key">Credential Key</Label>
        <Input
          id="cred-key"
          value={credFields["_key"] ?? ""}
          onChange={(e) => setCredFields((prev) => ({ ...prev, _key: e.target.value }))}
          placeholder="e.g. accessToken"
        />
      </div>
      <div>
        <Label htmlFor="cred-value">Credential Value</Label>
        <Input
          id="cred-value"
          type="password"
          value={credFields["_value"] ?? ""}
          onChange={(e) => setCredFields((prev) => ({ ...prev, _value: e.target.value }))}
          placeholder="****"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update the submit button disabled condition**

Replace the submit button disabled condition (line 341):

```ts
disabled={createConnection.isPending || !serviceId}
```

With a check that validates required fields when a service config exists:

```ts
disabled={
  createConnection.isPending ||
  !serviceId ||
  (SERVICE_FIELD_CONFIGS[serviceId]
    ? SERVICE_FIELD_CONFIGS[serviceId]
        .filter((f) => f.required)
        .some((f) => !credFields[f.key]?.trim())
    : false)
}
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: Clean exit.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: render service-specific credential fields in connections form"
```

---

### Task 3: Create the wizard ad platform step component

**Files:**

- Create: `apps/dashboard/src/components/onboarding/step-ad-platform.tsx`

Follow the existing pattern from `step-channels.tsx`: props interface with state + onChange callback, `"use client"`, shadcn/ui components.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SERVICE_FIELD_CONFIGS } from "@/lib/service-field-configs";

interface StepAdPlatformProps {
  adCredentials: Record<string, string>;
  onAdCredentialsChange: (creds: Record<string, string>) => void;
}

const metaAdsFields = SERVICE_FIELD_CONFIGS["meta-ads"] ?? [];

export function StepAdPlatform({ adCredentials, onAdCredentialsChange }: StepAdPlatformProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Label className="text-base">Connect your Meta Ads account</Label>
        <p className="text-[13px] text-muted-foreground">
          Your Ad Optimizer agent needs access to your Meta Ads account to monitor campaigns and
          suggest improvements. You can skip this and add it later from Settings.
        </p>
      </div>

      <div className="space-y-4">
        {metaAdsFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`wizard-${field.key}`}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={`wizard-${field.key}`}
              type={field.type}
              value={adCredentials[field.key] ?? ""}
              onChange={(e) =>
                onAdCredentialsChange({ ...adCredentials, [field.key]: e.target.value })
              }
              placeholder={field.placeholder}
            />
            {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: Clean exit.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add StepAdPlatform wizard component"
```

---

### Task 4: Wire the ad platform step into the onboarding wizard

**Files:**

- Modify: `apps/dashboard/src/app/onboarding/page.tsx`

This is the most delicate change. The wizard uses a static `STEP_LABELS` array and hard-coded step indices. We need to make step labels and step-to-index mapping dynamic based on `selectedAgents`.

- [ ] **Step 1: Add import and state**

Add after the existing imports (after line 13):

```ts
import { StepAdPlatform } from "@/components/onboarding/step-ad-platform";
```

Add new state after the channels state (after line 75):

```ts
// Step 5 (conditional): Ad platform credentials
const [adCredentials, setAdCredentials] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Replace static step labels with dynamic computation**

Replace the static `STEP_LABELS` constant (lines 15-22) with a computation inside the component, after the state declarations (after the new `adCredentials` state). Remove the old `const STEP_LABELS = [...]` block.

Add this after the state declarations:

```ts
const hasAdOptimizer = selectedAgents.includes("ad-optimizer");
const stepLabels = hasAdOptimizer
  ? [
      "Your business",
      "Build your team",
      "Set their style",
      "Teach them",
      "Connect channels",
      "Connect ads",
      "Meet your team",
    ]
  : [
      "Your business",
      "Build your team",
      "Set their style",
      "Teach them",
      "Connect channels",
      "Meet your team",
    ];
const adsStepIndex = hasAdOptimizer ? 5 : -1;
const launchStepIndex = stepLabels.length - 1;
```

- [ ] **Step 3: Update canProceed to handle the dynamic step**

Replace the `canProceed` computation (lines 83-100) with:

```ts
const canProceed = (() => {
  switch (step) {
    case 0:
      return businessName.trim() !== "" && services.trim() !== "";
    case 1:
      return selectedAgents.length > 0;
    case 2:
      return selectedAgents.every((id) => agentTones[id]);
    case 3:
      return true;
    case 4:
      return channels.founderChannel !== null;
    default:
      // Ads step (if present) and launch step are always true
      return true;
  }
})();
```

- [ ] **Step 4: Add Meta Ads connection creation to handleComplete**

In the `handleComplete` function, add after the channel provisioning block (after line 218, before `setLaunchStatus("done")`):

```ts
// 5. Create Meta Ads connection (if credentials provided)
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

- [ ] **Step 5: Update WizardShell and step rendering**

Replace the `return` JSX (lines 242-297) with:

```tsx
return (
  <WizardShell
    step={step}
    stepLabels={stepLabels}
    onNext={() => setStep((s) => Math.min(s + 1, stepLabels.length - 1))}
    onBack={() => setStep((s) => Math.max(s - 1, 0))}
    canProceed={canProceed}
    isSubmitting={isSubmitting}
    isLastStep={step === launchStepIndex}
    onComplete={handleComplete}
  >
    {step === 0 && (
      <StepBusinessBasics
        vertical={vertical}
        onVerticalChange={setVertical}
        businessName={businessName}
        onNameChange={setBusinessName}
        services={services}
        onServicesChange={setServices}
        targetCustomer={targetCustomer}
        onTargetCustomerChange={setTargetCustomer}
        pricingRange={pricingRange}
        onPricingRangeChange={setPricingRange}
      />
    )}
    {step === 1 && (
      <StepAgentSelection selected={selectedAgents} onSelectionChange={setSelectedAgents} />
    )}
    {step === 2 && (
      <StepAgentStyle
        selectedAgents={selectedAgents}
        agentTones={agentTones}
        onTonesChange={setAgentTones}
        businessName={businessName}
      />
    )}
    {step === 3 && (
      <StepKnowledgeRules
        knowledgeText={knowledgeText}
        onKnowledgeChange={setKnowledgeText}
        rules={rules}
        onRulesChange={setRules}
      />
    )}
    {step === 4 && <StepChannels channels={channels} onChannelsChange={setChannels} />}
    {step === adsStepIndex && (
      <StepAdPlatform adCredentials={adCredentials} onAdCredentialsChange={setAdCredentials} />
    )}
    {step === launchStepIndex && (
      <StepReviewLaunch
        businessName={businessName}
        selectedAgents={selectedAgents}
        agentTones={agentTones}
        channels={channels}
        launchStatus={launchStatus}
      />
    )}
  </WizardShell>
);
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: Clean exit.

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: All tests pass. The existing onboarding tests in `apps/dashboard/src/components/onboarding/__tests__/` should still pass since they test individual step components, not the page-level wiring.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: add conditional ad platform step to onboarding wizard"
```

---

### Task 5: Final verification and PR

- [ ] **Step 1: Run full CI checks locally**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: All pass.

- [ ] **Step 2: Create feature branch and push**

```bash
git checkout -b feat/service-specific-connections
git cherry-pick <commits-from-tasks-1-4>
git push -u origin feat/service-specific-connections
```

- [ ] **Step 3: Create PR**

```bash
gh pr create --title "feat: service-specific connection forms + wizard ad platform step" --body "$(cat <<'EOF'
## Summary
- Add labeled credential fields for Meta Ads (access token, account ID, pixel ID) in the connections form
- Generic key/value fallback preserved for services without specific configs
- Add optional "Connect ads" wizard step when Ad Optimizer agent is selected
- Shared `SERVICE_FIELD_CONFIGS` map used by both settings page and wizard

## Test plan
- [ ] Select "Meta Ads" in New Connection form → see labeled Access Token, Account ID, Pixel ID fields
- [ ] Select "Google Ads" → see generic key/value fallback
- [ ] Required field validation prevents submit with empty required fields
- [ ] Onboarding wizard with ad-optimizer selected → shows 7 steps including "Connect ads"
- [ ] Onboarding wizard without ad-optimizer → shows 6 steps (no "Connect ads")
- [ ] Wizard "Connect ads" step is skippable (optional)
- [ ] Complete wizard with Meta Ads creds → connection appears in Settings > Connections
EOF
)"
```
