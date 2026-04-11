# SP3: Onboarding Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end onboarding flow: per-agent setup schemas drive a dynamic wizard, the onboard endpoint auto-provisions deployments with widget connections (using tokenHash for O(1) lookup), and buyers review their scanned business profile before going live.

**Architecture:** Setup schemas (`OnboardingConfigSchema`, `SetupSchema`) added to `packages/schemas`. Prisma migration adds `AgentDeployment.slug` and `DeploymentConnection.tokenHash`. New `POST /api/marketplace/onboard` endpoint orchestrates provisioning. Token lookup optimized from O(N) decrypt-scan to O(1) hash lookup. Frontend: dynamic setup form renders from `setupSchema`, website scan review lets buyers edit extracted profile, and the deploy wizard gains conditional steps based on `onboarding` config.

**Tech Stack:** Zod, Prisma, Fastify, Next.js 14, React, TanStack React Query

---

## File Structure

| Action | Path                                                                   | Responsibility                                                                     |
| ------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Modify | `packages/schemas/src/marketplace.ts`                                  | Add `OnboardingConfigSchema`, `SetupFieldSchema`, `SetupStepSchema`, `SetupSchema` |
| Modify | `packages/db/prisma/schema.prisma`                                     | Add `AgentDeployment.slug`, `DeploymentConnection.tokenHash`                       |
| Modify | `packages/db/src/stores/prisma-deployment-connection-store.ts`         | Add `findByTokenHash()` method                                                     |
| Modify | `apps/chat/src/gateway/deployment-lookup.ts`                           | Use tokenHash for O(1) web_widget lookup                                           |
| Create | `apps/api/src/routes/onboard.ts`                                       | `POST /api/marketplace/onboard` endpoint                                           |
| Create | `apps/api/src/routes/__tests__/onboard.test.ts`                        | Onboard endpoint tests                                                             |
| Create | `apps/dashboard/src/components/marketplace/dynamic-setup-form.tsx`     | Renders form fields from `setupSchema.steps`                                       |
| Create | `apps/dashboard/src/components/marketplace/website-scan-review.tsx`    | Review/edit scanned business profile                                               |
| Modify | `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx` | Conditional steps from `onboarding` config                                         |

---

### Task 1: Add Setup Schemas to packages/schemas

**Files:**

- Modify: `packages/schemas/src/marketplace.ts`
- Modify: `packages/schemas/src/__tests__/marketplace.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/schemas/src/__tests__/marketplace.test.ts`:

```typescript
import {
  // ... existing imports ...
  OnboardingConfigSchema,
  SetupFieldSchema,
  SetupStepSchema,
  SetupSchema,
} from "../marketplace.js";

describe("OnboardingConfigSchema", () => {
  it("applies defaults when fields are omitted", () => {
    const result = OnboardingConfigSchema.parse({});
    expect(result.websiteScan).toBe(true);
    expect(result.publicChannels).toBe(false);
    expect(result.privateChannel).toBe(false);
    expect(result.integrations).toEqual([]);
  });

  it("accepts explicit values", () => {
    const result = OnboardingConfigSchema.parse({
      websiteScan: false,
      publicChannels: true,
      integrations: ["xero"],
    });
    expect(result.websiteScan).toBe(false);
    expect(result.publicChannels).toBe(true);
    expect(result.integrations).toEqual(["xero"]);
  });
});

describe("SetupSchema", () => {
  it("validates a complete setup schema", () => {
    const schema = {
      onboarding: { websiteScan: true, publicChannels: true },
      steps: [
        {
          id: "basics",
          title: "Basic Setup",
          fields: [
            {
              key: "tone",
              type: "select",
              label: "Tone",
              required: true,
              options: ["friendly", "professional"],
            },
            {
              key: "bookingLink",
              type: "url",
              label: "Booking Link",
              required: false,
              prefillFrom: "scannedProfile.website",
            },
          ],
        },
      ],
    };
    const result = SetupSchema.parse(schema);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].fields).toHaveLength(2);
    expect(result.onboarding.publicChannels).toBe(true);
  });

  it("rejects invalid field type", () => {
    expect(() =>
      SetupFieldSchema.parse({ key: "x", type: "invalid", label: "X", required: true }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run`
Expected: FAIL — schemas not exported

- [ ] **Step 3: Add the schemas**

Append to `packages/schemas/src/marketplace.ts` (after the `ScannedBusinessProfileSchema`):

```typescript
// ── Onboarding / Setup Schema ──

export const OnboardingConfigSchema = z.object({
  websiteScan: z.boolean().default(true),
  publicChannels: z.boolean().default(false),
  privateChannel: z.boolean().default(false),
  integrations: z.array(z.string()).default([]),
});

export type OnboardingConfig = z.infer<typeof OnboardingConfigSchema>;

export const SetupFieldSchema = z.object({
  key: z.string(),
  type: z.enum(["text", "textarea", "select", "url", "toggle"]),
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
  prefillFrom: z.string().optional(),
});

export type SetupField = z.infer<typeof SetupFieldSchema>;

export const SetupStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  fields: z.array(SetupFieldSchema),
});

export type SetupStep = z.infer<typeof SetupStepSchema>;

export const SetupSchema = z.object({
  onboarding: OnboardingConfigSchema,
  steps: z.array(SetupStepSchema),
});

export type SetupSchemaType = z.infer<typeof SetupSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/ && git commit -m "feat(schemas): add OnboardingConfig and SetupSchema"
```

---

### Task 2: Prisma Migration — slug + tokenHash

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `slug` to AgentDeployment**

In the `AgentDeployment` model, add after `status`:

```prisma
  slug                String?  @unique
```

- [ ] **Step 2: Add `tokenHash` to DeploymentConnection**

In the `DeploymentConnection` model, add after `metadata`:

```prisma
  tokenHash    String?  @unique
```

- [ ] **Step 3: Generate and create migration**

```bash
npx pnpm@9.15.4 db:generate
npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add-slug-and-token-hash --create-only
```

If the shadow DB blocks (`vector` extension), hand-write the migration SQL:

```sql
ALTER TABLE "AgentDeployment" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "AgentDeployment_slug_key" ON "AgentDeployment"("slug");

ALTER TABLE "DeploymentConnection" ADD COLUMN "tokenHash" TEXT;
CREATE UNIQUE INDEX "DeploymentConnection_tokenHash_key" ON "DeploymentConnection"("tokenHash");
```

Then apply: `npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate resolve --applied <migration_name>`

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx pnpm@9.15.4 db:generate
```

- [ ] **Step 5: Update store interfaces to accept new fields**

In `packages/db/src/stores/prisma-deployment-store.ts`, add `slug?: string` to `CreateDeploymentInput` and pass it through in the `create` method:

```typescript
interface CreateDeploymentInput {
  // ... existing fields ...
  slug?: string;  // NEW
}

// In create(), add to data object:
slug: input.slug ?? undefined,
```

In `packages/db/src/stores/prisma-deployment-connection-store.ts`, add `tokenHash?: string` to `CreateConnectionInput` and pass it through:

```typescript
interface CreateConnectionInput {
  // ... existing fields ...
  tokenHash?: string;  // NEW
}

// In create(), add to data object:
tokenHash: input.tokenHash ?? undefined,
```

Also add `findByTokenHash` method:

```typescript
async findByTokenHash(tokenHash: string) {
  return this.prisma.deploymentConnection.findUnique({
    where: { tokenHash },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/ packages/db/src/ && git commit -m "feat(db): add AgentDeployment.slug, DeploymentConnection.tokenHash, and store methods"
```

---

### Task 3: TokenHash Store Method + Lookup Optimization

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-connection-store.ts`
- Modify: `apps/chat/src/gateway/deployment-lookup.ts`
- Modify: `apps/api/src/routes/marketplace.ts` (widget connection creation)

- [ ] **Step 1: Read existing files**

Read:

- `packages/db/src/stores/prisma-deployment-connection-store.ts`
- `apps/chat/src/gateway/deployment-lookup.ts`
- The widget connection creation section in `apps/api/src/routes/marketplace.ts` (search for `web_widget`)

- [ ] **Step 2: Add `findByTokenHash` to the connection store**

The `findByTokenHash` method was already added to the store in Task 2 Step 5. Verify it exists by reading the file.

- [ ] **Step 3: Update widget connection creation to store tokenHash**

In `apps/api/src/routes/marketplace.ts`, find the widget connection POST route. After the token is generated and encrypted, compute and store the hash:

```typescript
import { createHash } from "node:crypto";

// After: const token = "sw_" + randomBytes(15).toString("base64url").slice(0, 20);
const tokenHash = createHash("sha256").update(token).digest("hex");

// In the connectionStore.create() call, add tokenHash:
const connection = await connectionStore.create({
  deploymentId,
  type: "web_widget",
  credentials: encrypted,
  metadata: {},
  tokenHash, // NEW
});
```

Note: The `create` method in the store uses `prisma.deploymentConnection.create()` with spread input. You may need to add `tokenHash` to the `CreateConnectionInput` type or pass it through the data object.

- [ ] **Step 4: Update PrismaDeploymentLookup for O(1) web_widget lookup**

In `apps/chat/src/gateway/deployment-lookup.ts`, replace the O(N) web_widget scan with:

```typescript
import { createHash } from "node:crypto";

// Replace the for-loop decrypt scan with:
if (channel === "web_widget") {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const connection = await this.prisma.deploymentConnection.findUnique({
    where: { tokenHash },
  });
  if (connection && connection.status === "active") {
    matchedDeploymentId = connection.deploymentId;
  }
}
```

Keep the Telegram O(1) path unchanged. Keep the 60-second cache.

- [ ] **Step 5: Verify tests still pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/core test -- --run`
Run: `npx pnpm@9.15.4 --filter @switchboard/db test -- --run` (if tests exist)

- [ ] **Step 6: Commit**

```bash
git add packages/db/ apps/chat/ apps/api/ && git commit -m "feat: tokenHash optimization for O(1) widget token lookup"
```

---

### Task 4: Onboard API Endpoint

**Files:**

- Create: `apps/api/src/routes/onboard.ts`
- Create: `apps/api/src/routes/__tests__/onboard.test.ts`
- Modify: `apps/api/src/server.ts` (or wherever routes are registered)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/__tests__/onboard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { slugify } from "../onboard.js";

describe("slugify", () => {
  it("converts business name to slug", () => {
    expect(slugify("Austin Bakery")).toBe("austin-bakery");
  });

  it("removes special characters", () => {
    expect(slugify("Bob's Pizza & Pasta")).toBe("bobs-pizza-pasta");
  });

  it("handles collision suffix", () => {
    expect(slugify("Austin Bakery", 2)).toBe("austin-bakery-2");
  });

  it("trims and collapses dashes", () => {
    expect(slugify("  The   Great   Place  ")).toBe("the-great-place");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter api test -- --run onboard`
Expected: FAIL

- [ ] **Step 3: Implement the onboard route**

Create `apps/api/src/routes/onboard.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import {
  PrismaDeploymentStore,
  PrismaDeploymentConnectionStore,
  PrismaListingStore,
  encryptCredentials,
} from "@switchboard/db";
import { SetupSchema, OnboardingConfigSchema } from "@switchboard/schemas";
import { z } from "zod";

const DEFAULT_ONBOARDING = {
  websiteScan: true,
  publicChannels: true,
  privateChannel: false,
  integrations: [] as string[],
};

const OnboardInput = z.object({
  listingId: z.string().min(1),
  setupAnswers: z.record(z.unknown()).default({}),
  scannedProfile: z.record(z.unknown()).optional(),
  businessName: z.string().min(1),
});

export function slugify(name: string, suffix?: number): string {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (suffix && suffix > 1) slug += `-${suffix}`;
  return slug;
}

export const onboardRoutes: FastifyPluginAsync = async (app) => {
  const listingStore = new PrismaListingStore(app.prisma);
  const deploymentStore = new PrismaDeploymentStore(app.prisma);
  const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);

  app.post("/api/marketplace/onboard", async (request, reply) => {
    const orgId = (request as any).organizationId;
    if (!orgId) return reply.code(401).send({ error: "Unauthorized" });

    const body = OnboardInput.parse(request.body);
    const listing = await listingStore.findById(body.listingId);
    if (!listing) return reply.code(404).send({ error: "Listing not found" });

    // Resolve onboarding config from listing metadata or defaults
    const metadata = (listing.metadata as Record<string, unknown>) ?? {};
    let onboarding = DEFAULT_ONBOARDING;
    if (metadata.setupSchema) {
      const parsed = SetupSchema.safeParse(metadata.setupSchema);
      if (parsed.success) {
        onboarding = { ...DEFAULT_ONBOARDING, ...parsed.data.onboarding };
      }
    }

    // Generate unique slug
    let slug = slugify(body.businessName);
    let suffix = 1;
    while (true) {
      const candidate = suffix === 1 ? slug : `${slug}-${suffix}`;
      const existing = await app.prisma.agentDeployment.findUnique({
        where: { slug: candidate },
      });
      if (!existing) {
        slug = candidate;
        break;
      }
      suffix++;
      if (suffix > 100) {
        slug = `${slug}-${randomBytes(4).toString("hex")}`;
        break;
      }
    }

    // Create deployment
    const inputConfig = {
      ...body.setupAnswers,
      scannedProfile: body.scannedProfile ?? null,
      businessName: body.businessName,
    };

    const deployment = await deploymentStore.create({
      organizationId: orgId,
      listingId: body.listingId,
      inputConfig,
      governanceSettings: { startingAutonomy: "supervised" },
      slug,
    });

    const result: Record<string, unknown> = {
      deploymentId: deployment.id,
      slug,
      dashboardUrl: `/deployments/${deployment.id}`,
    };

    // Auto-create widget connection if publicChannels
    if (onboarding.publicChannels) {
      const token = "sw_" + randomBytes(15).toString("base64url").slice(0, 20);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const encrypted = encryptCredentials({ token });

      await connectionStore.create({
        deploymentId: deployment.id,
        type: "web_widget",
        credentials: encrypted,
        tokenHash,
      });

      result.storefrontUrl = `/agent/${slug}`;
      result.widgetToken = token;
      result.embedCode = `<script src="${process.env.CHAT_SERVER_URL || "http://localhost:3001"}/widget.js" data-token="${token}"></script>`;
    }

    return reply.code(201).send(result);
  });
};
```

- [ ] **Step 4: Register the route**

In `apps/api/src/bootstrap/routes.ts`, add the import and registration:

```typescript
import { onboardRoutes } from "../routes/onboard.js";

// In registerRoutes(), add:
await app.register(onboardRoutes, { prefix: "/api/marketplace" });
```

Then in `apps/api/src/routes/onboard.ts`, change the route path to just `/onboard` (prefix is applied by the registration):

```typescript
app.post("/onboard", async (request, reply) => { ... });
```

- [ ] **Step 5: Create dashboard proxy route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/onboard/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getApiClient } from "@/lib/get-api-client";

export async function POST(request: NextRequest) {
  try {
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.post("/api/marketplace/onboard", body);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Note: Check `getApiClient()` implementation — it may use a different pattern for POST requests. Read `apps/dashboard/src/lib/get-api-client.ts` and follow the existing POST pattern.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx pnpm@9.15.4 --filter api test -- --run onboard`
Expected: PASS (slugify tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/ && git commit -m "feat(api): add POST /api/marketplace/onboard endpoint"
```

---

### Task 5: Dynamic Setup Form Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/dynamic-setup-form.tsx`

- [ ] **Step 1: Read existing wizard step pattern**

Read `apps/dashboard/src/components/marketplace/scan-step.tsx` to understand the `WizardStepProps` interface and how steps interact with the wizard data.

- [ ] **Step 2: Create the dynamic form component**

Create `apps/dashboard/src/components/marketplace/dynamic-setup-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface SetupField {
  key: string;
  type: "text" | "textarea" | "select" | "url" | "toggle";
  label: string;
  required: boolean;
  options?: string[];
  default?: string;
  prefillFrom?: string;
}

interface SetupStep {
  id: string;
  title: string;
  fields: SetupField[];
}

interface DynamicSetupFormProps {
  steps: SetupStep[];
  scannedProfile?: Record<string, unknown>;
  onSubmit: (answers: Record<string, string>) => void;
  onBack?: () => void;
}

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function DynamicSetupForm({
  steps,
  scannedProfile,
  onSubmit,
  onBack,
}: DynamicSetupFormProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // Pre-fill defaults and scanned profile values
    const initial: Record<string, string> = {};
    for (const step of steps) {
      for (const field of step.fields) {
        if (field.prefillFrom && scannedProfile) {
          const value = getNestedValue(scannedProfile, field.prefillFrom);
          if (value) initial[field.key] = value;
        } else if (field.default) {
          initial[field.key] = field.default;
        }
      }
    }
    return initial;
  });

  const step = steps[currentStep];
  if (!step) return null;

  const updateField = (key: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };

  const isStepValid = step.fields.filter((f) => f.required).every((f) => answers[f.key]?.trim());

  const isLastStep = currentStep === steps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onSubmit(answers);
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{step.title}</h3>
        {steps.length > 1 && (
          <p className="text-sm text-muted-foreground">
            Step {currentStep + 1} of {steps.length}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {step.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={field.key}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>

            {field.type === "text" || field.type === "url" ? (
              <Input
                id={field.key}
                type={field.type === "url" ? "url" : "text"}
                value={answers[field.key] ?? ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={field.type === "url" ? "https://..." : ""}
              />
            ) : field.type === "textarea" ? (
              <Textarea
                id={field.key}
                value={answers[field.key] ?? ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                rows={3}
              />
            ) : field.type === "select" && field.options ? (
              <Select
                value={answers[field.key] ?? ""}
                onValueChange={(v) => updateField(field.key, v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "toggle" ? (
              <Switch
                id={field.key}
                checked={answers[field.key] === "true"}
                onCheckedChange={(checked) => updateField(field.key, String(checked))}
              />
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <Button
          variant="outline"
          onClick={currentStep > 0 ? () => setCurrentStep((prev) => prev - 1) : onBack}
          disabled={currentStep === 0 && !onBack}
        >
          Back
        </Button>
        <Button onClick={handleNext} disabled={!isStepValid}>
          {isLastStep ? "Continue" : "Next"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/marketplace/dynamic-setup-form.tsx && git commit -m "feat(dashboard): add dynamic setup form from setupSchema"
```

---

### Task 6: Website Scan Review Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/website-scan-review.tsx`

- [ ] **Step 1: Create the component**

Create `apps/dashboard/src/components/marketplace/website-scan-review.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ScannedProfile {
  businessName: string;
  description: string;
  products: Array<{ name: string; description: string; price?: string }>;
  services: string[];
  location?: { address: string; city: string; state: string };
  hours?: Record<string, string>;
  phone?: string;
  email?: string;
  faqs: Array<{ question: string; answer: string }>;
  brandLanguage: string[];
  platformDetected?: string;
}

interface WebsiteScanReviewProps {
  profile: ScannedProfile;
  onConfirm: (edited: ScannedProfile) => void;
  onBack?: () => void;
}

export function WebsiteScanReview({ profile, onConfirm, onBack }: WebsiteScanReviewProps) {
  const [edited, setEdited] = useState<ScannedProfile>(profile);

  const update = <K extends keyof ScannedProfile>(key: K, value: ScannedProfile[K]) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Review Your Business Profile</h3>
        <p className="text-sm text-muted-foreground">
          We scanned your website and extracted this information. Review and correct anything that
          looks off.
        </p>
        {edited.platformDetected && (
          <Badge variant="secondary" className="mt-2">
            {edited.platformDetected} detected
          </Badge>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Business Name</Label>
          <Input
            value={edited.businessName}
            onChange={(e) => update("businessName", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={edited.description}
            onChange={(e) => update("description", e.target.value)}
            rows={3}
          />
        </div>

        {edited.phone !== undefined && (
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input value={edited.phone ?? ""} onChange={(e) => update("phone", e.target.value)} />
          </div>
        )}

        {edited.email !== undefined && (
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={edited.email ?? ""} onChange={(e) => update("email", e.target.value)} />
          </div>
        )}

        {edited.services.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Services</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {edited.services.map((s, i) => (
                  <Badge key={i} variant="outline">
                    {s}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {edited.products.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Products ({edited.products.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {edited.products.map((p, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  {p.price && <span className="text-muted-foreground ml-2">{p.price}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {edited.brandLanguage.length > 0 && (
          <div className="space-y-2">
            <Label>Brand Language</Label>
            <div className="flex flex-wrap gap-2">
              {edited.brandLanguage.map((word, i) => (
                <Badge key={i}>{word}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-4">
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        )}
        <Button onClick={() => onConfirm(edited)} className="ml-auto">
          Looks Good — Continue
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/marketplace/website-scan-review.tsx && git commit -m "feat(dashboard): add website scan review component"
```

---

### Task 7: Update Deploy Wizard with Conditional Onboarding Steps

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx`
- Modify: `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`

- [ ] **Step 1: Read the existing files**

Read:

- `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx`
- `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`
- `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx` (for `WizardStep` and `WizardData` interfaces)

- [ ] **Step 2: Extend WizardData with scannedProfile**

In `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`, add `scannedProfile` to the `WizardData` interface:

```typescript
export interface WizardData {
  // ... existing fields ...
  scannedProfile?: Record<string, unknown>; // NEW — from website scanner
}
```

- [ ] **Step 3: Update the server page to pass setupSchema**

In `apps/dashboard/src/app/(auth)/deploy/[slug]/page.tsx`, extract `setupSchema` from the listing metadata and pass it to `DeployWizardClient`:

```tsx
// After fetching the listing:
const setupSchema = listing.metadata?.setupSchema ?? null;

// Pass to client component:
<DeployWizardClient
  listingId={listing.id}
  listingSlug={listing.slug}
  agentName={listing.name}
  roleFocus={roleFocus}
  connections={connections}
  setupSchema={setupSchema}
/>;
```

- [ ] **Step 4: Update DeployWizardClient to use conditional steps**

Add a `setupSchema` prop and use it to conditionally build the wizard steps:

```tsx
import { DynamicSetupForm } from "@/components/marketplace/dynamic-setup-form";
import { WebsiteScanReview } from "@/components/marketplace/website-scan-review";

interface DeployWizardClientProps {
  // ... existing props ...
  setupSchema?: { onboarding: Record<string, unknown>; steps: Array<unknown> } | null;
}

// In the step assembly, resolve the onboarding config:
const onboarding = setupSchema?.onboarding ?? {
  websiteScan: true,
  publicChannels: true,
  privateChannel: false,
  integrations: [],
};

const steps: WizardStep[] = [];

// Step 1: Website scan (conditional)
if (onboarding.websiteScan !== false) {
  steps.push({ id: "scan", label: "Scan Website", component: ScanStep });
}

// Step 2: Review scan results (conditional — only if scan step exists)
if (onboarding.websiteScan !== false) {
  steps.push({
    id: "review-scan",
    label: "Review Profile",
    component: ReviewScanStep, // New wrapper component
  });
}

// Step 3: Agent-specific setup (from setupSchema.steps, or default persona form)
if (setupSchema?.steps && setupSchema.steps.length > 0) {
  steps.push({
    id: "agent-setup",
    label: "Configure Agent",
    component: AgentSetupStep, // Wrapper around DynamicSetupForm
  });
} else {
  steps.push({ id: "review", label: "Configure Agent", component: ReviewPersonaStep });
}

// Step N: Connection steps (existing behavior)
// ... existing connection step logic ...

// Last: Test chat
steps.push({
  id: "test-chat",
  label: "Test Chat",
  component: TestChatStep,
  props: { onDeploy: handleDeploy },
});
```

The exact implementation depends on the existing step structure. The key change is making the scan, review, and setup steps conditional based on `onboarding`.

- [ ] **Step 5: Update handleDeploy to call onboard endpoint**

Replace the existing deploy POST to use the new `/api/marketplace/onboard` endpoint:

```tsx
const handleDeploy = async () => {
  const res = await fetch("/api/dashboard/marketplace/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      listingId,
      businessName: data.persona?.businessName ?? "My Business",
      setupAnswers: data.persona ?? {},
      scannedProfile: data.scannedProfile ?? null,
    }),
  });
  const result = await res.json();
  router.push(result.dashboardUrl || `/deployments/${result.deploymentId}`);
};
```

Note: You may need a dashboard proxy route at `apps/dashboard/src/app/api/dashboard/marketplace/onboard/route.ts` to forward to the API server, following the pattern of existing proxy routes.

- [ ] **Step 6: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/ && git commit -m "feat(dashboard): conditional onboarding steps from setupSchema"
```

---

## Verification Checklist

After all tasks are complete:

1. `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run` — all schema tests pass
2. `npx pnpm@9.15.4 --filter @switchboard/core test -- --run` — all core tests pass
3. `npx pnpm@9.15.4 --filter api test -- --run` — API tests pass
4. `npx pnpm@9.15.4 --filter dashboard typecheck` — no new type errors
5. Widget token lookup is now O(1) via tokenHash
6. Onboard endpoint creates deployment + widget connection in one call
7. Deploy wizard conditionally shows scan/review/setup steps based on listing's setupSchema
