# Phase 0: Setup Schema + Family Enum — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `setupSchema` into all existing marketplace listings and add the `family` enum to `AgentListingSchema`, so the buyer experience flow (SP1-SP6) works end-to-end and the marketplace can filter by agent family.

**Architecture:** Add `AgentFamily` enum to schemas. Update seed data with proper `setupSchema` (onboarding config + setup steps) for each listing. Update PCD listing status from `pending_review` to `listed`. Remove placeholder listings (Trading, Finance) that have no backing code.

**Tech Stack:** Zod, Prisma seed, TypeScript

---

## File Structure

| Action | Path                                                 | Responsibility                                                  |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| Modify | `packages/schemas/src/marketplace.ts`                | Add `AgentFamily` enum, add to `AgentListingSchema`             |
| Modify | `packages/schemas/src/__tests__/marketplace.test.ts` | Tests for `AgentFamily`                                         |
| Modify | `packages/db/prisma/seed-marketplace.ts`             | Add `setupSchema` to all listings, set `family`, fix PCD status |

---

### Task 1: Add AgentFamily Enum to Schemas

**Files:**

- Modify: `packages/schemas/src/marketplace.ts`
- Modify: `packages/schemas/src/__tests__/marketplace.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/schemas/src/__tests__/marketplace.test.ts`:

```typescript
import { AgentFamily } from "../marketplace.js";

describe("AgentFamily", () => {
  it("accepts valid family values", () => {
    expect(AgentFamily.parse("sales_pipeline")).toBe("sales_pipeline");
    expect(AgentFamily.parse("paid_media")).toBe("paid_media");
    expect(AgentFamily.parse("organic_growth")).toBe("organic_growth");
    expect(AgentFamily.parse("customer_experience")).toBe("customer_experience");
  });

  it("rejects invalid family", () => {
    expect(() => AgentFamily.parse("invalid")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests — verify fail**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run`

- [ ] **Step 3: Add the enum**

In `packages/schemas/src/marketplace.ts`, add after `AgentType`:

```typescript
export const AgentFamily = z.enum([
  "sales_pipeline",
  "paid_media",
  "organic_growth",
  "customer_experience",
]);
export type AgentFamily = z.infer<typeof AgentFamily>;
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run`

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/ && git commit -m "feat(schemas): add AgentFamily enum"
```

---

### Task 2: Wire setupSchema into Seed Data

**Files:**

- Modify: `packages/db/prisma/seed-marketplace.ts`

- [ ] **Step 1: Read the existing seed file**

Read `packages/db/prisma/seed-marketplace.ts` fully.

- [ ] **Step 2: Add setupSchema to Sales Pipeline agents**

Update each agent in `SALES_PIPELINE_AGENTS` to include `setupSchema` in their metadata. All 3 sales agents are customer-facing (publicChannels: true) and use websiteScan:

```typescript
const SALES_PIPELINE_AGENTS = [
  {
    name: "Speed-to-Lead Rep",
    slug: "speed-to-lead",
    description:
      "Responds to inbound leads within 60 seconds. Qualifies through natural conversation.",
    taskCategories: ["lead-qualification"],
    metadata: {
      bundleSlug: "sales-pipeline-bundle",
      roleFocus: "leads",
      family: "sales_pipeline",
      setupSchema: {
        onboarding: {
          websiteScan: true,
          publicChannels: true,
          privateChannel: false,
          integrations: [],
        },
        steps: [
          {
            id: "agent-config",
            title: "Configure Your Agent",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Conversation Tone",
                required: true,
                options: ["casual", "professional", "consultative"],
                default: "professional",
              },
              {
                key: "bookingLink",
                type: "url",
                label: "Booking / Calendar Link",
                required: false,
                prefillFrom: "scannedProfile.website",
              },
              {
                key: "customInstructions",
                type: "textarea",
                label: "Special Instructions",
                required: false,
              },
            ],
          },
        ],
      },
    },
  },
  {
    name: "Sales Closer",
    slug: "sales-closer",
    description:
      "Takes qualified leads and closes them. Handles objections, builds urgency, confirms decisions.",
    taskCategories: ["sales-closing"],
    metadata: {
      bundleSlug: "sales-pipeline-bundle",
      roleFocus: "growth",
      family: "sales_pipeline",
      setupSchema: {
        onboarding: {
          websiteScan: true,
          publicChannels: true,
          privateChannel: false,
          integrations: [],
        },
        steps: [
          {
            id: "agent-config",
            title: "Configure Your Agent",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Conversation Tone",
                required: true,
                options: ["casual", "professional", "consultative"],
                default: "professional",
              },
              { key: "bookingLink", type: "url", label: "Booking / Calendar Link", required: true },
              {
                key: "customInstructions",
                type: "textarea",
                label: "Special Instructions",
                required: false,
              },
            ],
          },
        ],
      },
    },
  },
  {
    name: "Nurture Specialist",
    slug: "nurture-specialist",
    description:
      "Re-engages cold leads through scheduled follow-ups. Varies approach across cadence.",
    taskCategories: ["lead-nurturing"],
    metadata: {
      bundleSlug: "sales-pipeline-bundle",
      roleFocus: "care",
      family: "sales_pipeline",
      setupSchema: {
        onboarding: {
          websiteScan: true,
          publicChannels: false,
          privateChannel: false,
          integrations: [],
        },
        steps: [
          {
            id: "agent-config",
            title: "Configure Your Agent",
            fields: [
              {
                key: "tone",
                type: "select",
                label: "Conversation Tone",
                required: true,
                options: ["casual", "professional", "consultative"],
                default: "professional",
              },
              {
                key: "customInstructions",
                type: "textarea",
                label: "Special Instructions",
                required: false,
              },
            ],
          },
        ],
      },
    },
  },
];
```

- [ ] **Step 3: Add setupSchema to Sales Pipeline Bundle**

Update the bundle metadata:

```typescript
metadata: {
  isBundle: true,
  family: "sales_pipeline",
  bundleListingIds: agentIds,
  setupSchema: {
    onboarding: { websiteScan: true, publicChannels: true, privateChannel: false, integrations: [] },
    steps: [
      {
        id: "agent-config",
        title: "Configure Your Sales Team",
        fields: [
          { key: "tone", type: "select", label: "Conversation Tone", required: true, options: ["casual", "professional", "consultative"], default: "professional" },
          { key: "bookingLink", type: "url", label: "Booking / Calendar Link", required: true },
          { key: "customInstructions", type: "textarea", label: "Special Instructions", required: false },
        ],
      },
    ],
  },
},
```

- [ ] **Step 4: Update PCD listing**

Change PCD from `pending_review` to `listed` and add setupSchema:

```typescript
{
  name: "Performance Creative Director",
  slug: "performance-creative-director",
  description: "Full creative pipeline — from trend analysis and hooks to scripts, storyboards, and produced video ads.",
  taskCategories: ["creative_strategy", "hooks", "scripts", "storyboard", "production"],
  metadata: {
    isBundle: false,
    family: "paid_media",
    stages: ["trends", "hooks", "scripts", "storyboard", "production"],
    setupSchema: {
      onboarding: { websiteScan: true, publicChannels: false, privateChannel: false, integrations: [] },
      steps: [
        {
          id: "creative-brief",
          title: "Creative Brief Basics",
          fields: [
            { key: "targetAudience", type: "textarea", label: "Target Audience", required: true, prefillFrom: "scannedProfile.description" },
            { key: "platforms", type: "select", label: "Primary Platform", required: true, options: ["meta", "youtube", "tiktok"] },
            { key: "brandVoice", type: "textarea", label: "Brand Voice / Style", required: false, prefillFrom: "scannedProfile.brandLanguage" },
          ],
        },
      ],
    },
  },
},
```

And change its status to `"listed"` in the upsert create block.

- [ ] **Step 5: Remove placeholder listings**

Remove "Trading" and "Finance" from `FUTURE_FAMILIES` — they have no backing code and clutter the marketplace. They can be re-added when their agents are actually built.

- [ ] **Step 6: Verify seed runs**

Run: `npx pnpm@9.15.4 db:seed` (or manually verify the seed file compiles)

If the seed can't run without a database, at minimum verify: `npx pnpm@9.15.4 --filter @switchboard/db typecheck`

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/seed-marketplace.ts && git commit -m "feat(db): wire setupSchema into all listings, add family, list PCD"
```

---

## Verification Checklist

1. `npx pnpm@9.15.4 --filter @switchboard/schemas test -- --run` — all pass
2. `npx pnpm@9.15.4 --filter @switchboard/db typecheck` — no errors
3. All 5 active listings have `metadata.setupSchema` with proper `onboarding` config
4. PCD status is `listed` (not `pending_review`)
5. Trading and Finance placeholders removed
6. `AgentFamily` enum has 4 values
