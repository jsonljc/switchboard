# Alex Three-Bucket Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alex's routing explicit — structured business facts for Bucket B, wired escalation for Bucket C, deployment gate to prevent going live without facts.

**Architecture:** Two slices. Slice 1 adds BusinessFactsSchema, store, API, dashboard form, context injection, and grounding rules. Slice 2 adds the escalate tool, wires HandoffNotifier, retires pipeline-handoff, and adds end-to-end escalation tests.

**Tech Stack:** Zod, Prisma, Vitest, Next.js 14 (App Router), React, Tailwind + shadcn/ui, TypeScript ESM

---

## Slice 1: Bucket B — Business Facts

### Task 1: BusinessFactsSchema

**Files:**

- Modify: `packages/schemas/src/marketplace.ts` (append after line 247)
- Modify: `packages/schemas/src/__tests__/marketplace.test.ts` (append new describe block)

- [ ] **Step 1: Write the failing tests**

Add to `packages/schemas/src/__tests__/marketplace.test.ts`:

```typescript
import {
  // ... existing imports ...
  BusinessFactsSchema,
} from "../marketplace.js";

describe("BusinessFactsSchema", () => {
  const validFacts = {
    businessName: "Glow Dental",
    timezone: "Asia/Singapore",
    locations: [{ name: "Main", address: "123 Orchard Rd" }],
    openingHours: {
      monday: { open: "09:00", close: "18:00" },
      tuesday: { open: "09:00", close: "18:00" },
      sunday: { open: "09:00", close: "18:00", closed: true },
    },
    services: [{ name: "Teeth Cleaning", description: "Standard cleaning" }],
    escalationContact: { name: "Dr Tan", channel: "whatsapp" as const, address: "+6591234567" },
  };

  it("validates a complete set of business facts", () => {
    const result = BusinessFactsSchema.safeParse(validFacts);
    expect(result.success).toBe(true);
  });

  it("applies defaults for timezone and additionalFaqs", () => {
    const minimal = {
      businessName: "Test Biz",
      locations: [{ name: "HQ", address: "1 Main St" }],
      openingHours: { monday: { open: "09:00", close: "17:00" } },
      services: [{ name: "Consult", description: "Initial consultation" }],
      escalationContact: { name: "Owner", channel: "email" as const, address: "a@b.com" },
    };
    const result = BusinessFactsSchema.parse(minimal);
    expect(result.timezone).toBe("Asia/Singapore");
    expect(result.additionalFaqs).toEqual([]);
  });

  it("rejects when locations is empty", () => {
    const bad = { ...validFacts, locations: [] };
    const result = BusinessFactsSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects when services is empty", () => {
    const bad = { ...validFacts, services: [] };
    const result = BusinessFactsSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects when escalationContact is missing", () => {
    const { escalationContact: _, ...bad } = validFacts;
    const result = BusinessFactsSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts optional bookingPolicies", () => {
    const withPolicies = {
      ...validFacts,
      bookingPolicies: {
        cancellationPolicy: "24 hours notice required",
        prepInstructions: "Brush your teeth before arriving",
      },
    };
    const result = BusinessFactsSchema.safeParse(withPolicies);
    expect(result.success).toBe(true);
  });

  it("accepts optional additionalFaqs", () => {
    const withFaqs = {
      ...validFacts,
      additionalFaqs: [
        { question: "Do you have parking?", answer: "Yes, basement parking available" },
      ],
    };
    const result = BusinessFactsSchema.safeParse(withFaqs);
    expect(result.success).toBe(true);
  });

  it("accepts optional service fields", () => {
    const withOptional = {
      ...validFacts,
      services: [
        {
          name: "Teeth Cleaning",
          description: "Standard cleaning",
          durationMinutes: 30,
          price: "150",
          currency: "SGD",
        },
      ],
    };
    const result = BusinessFactsSchema.safeParse(withOptional);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- --run -t "BusinessFactsSchema"`
Expected: FAIL — `BusinessFactsSchema` is not exported from `../marketplace.js`

- [ ] **Step 3: Add BusinessFactsSchema to marketplace.ts**

Append to end of `packages/schemas/src/marketplace.ts`:

```typescript
// ── Business Facts (Operator-Approved Structured Knowledge) ──

export const BusinessFactsSchema = z.object({
  businessName: z.string().min(1),
  timezone: z.string().default("Asia/Singapore"),
  locations: z
    .array(
      z.object({
        name: z.string().min(1),
        address: z.string().min(1),
        parkingNotes: z.string().optional(),
        accessNotes: z.string().optional(),
      }),
    )
    .min(1),
  openingHours: z.record(
    z.string(),
    z.object({
      open: z.string(),
      close: z.string(),
      closed: z.boolean().default(false),
    }),
  ),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        durationMinutes: z.number().int().positive().optional(),
        price: z.string().optional(),
        currency: z.string().default("SGD"),
      }),
    )
    .min(1),
  bookingPolicies: z
    .object({
      cancellationPolicy: z.string().optional(),
      reschedulePolicy: z.string().optional(),
      noShowPolicy: z.string().optional(),
      advanceBookingDays: z.number().int().positive().optional(),
      prepInstructions: z.string().optional(),
    })
    .optional(),
  escalationContact: z.object({
    name: z.string().min(1),
    channel: z.enum(["whatsapp", "telegram", "email", "sms"]),
    address: z.string().min(1),
  }),
  additionalFaqs: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      }),
    )
    .default([]),
});

export type BusinessFacts = z.infer<typeof BusinessFactsSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/schemas test -- --run -t "BusinessFactsSchema"`
Expected: PASS — all 8 tests

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/marketplace.ts packages/schemas/src/__tests__/marketplace.test.ts && git commit -m "$(cat <<'EOF'
feat: add BusinessFactsSchema for structured operator knowledge

Structured Zod schema for business facts (hours, services, pricing,
policies, escalation contact) that Alex uses for Bucket B grounded answers.
EOF
)"
```

---

### Task 2: Add `business-facts` to KnowledgeKindSchema

**Files:**

- Modify: `packages/schemas/src/knowledge.ts:7` (extend enum)
- Modify: `packages/schemas/src/__tests__/knowledge.test.ts:10-13` (add validation case)

- [ ] **Step 1: Write the failing test**

In `packages/schemas/src/__tests__/knowledge.test.ts`, inside the `"KnowledgeKindSchema"` describe block, add:

```typescript
it("accepts business-facts kind", () => {
  expect(KnowledgeKindSchema.parse("business-facts")).toBe("business-facts");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test -- --run -t "accepts business-facts kind"`
Expected: FAIL — `"business-facts"` is not in the enum

- [ ] **Step 3: Add `business-facts` to the enum**

In `packages/schemas/src/knowledge.ts` line 7, change:

```typescript
export const KnowledgeKindSchema = z.enum(["playbook", "policy", "knowledge"]);
```

to:

```typescript
export const KnowledgeKindSchema = z.enum(["playbook", "policy", "knowledge", "business-facts"]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/schemas test -- --run`
Expected: PASS — all knowledge tests pass, including new one

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/knowledge.ts packages/schemas/src/__tests__/knowledge.test.ts && git commit -m "$(cat <<'EOF'
feat: add business-facts to KnowledgeKindSchema

New context kind for operator-approved structured business facts,
resolved separately from RAG-based knowledge entries.
EOF
)"
```

---

### Task 3: PrismaBusinessFactsStore

**Files:**

- Create: `packages/db/src/stores/prisma-business-facts-store.ts`
- Create: `packages/db/src/stores/__tests__/prisma-business-facts-store.test.ts`
- Modify: `packages/db/src/index.ts` (add export)

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/stores/__tests__/prisma-business-facts-store.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaBusinessFactsStore } from "../prisma-business-facts-store.js";
import type { BusinessFacts } from "@switchboard/schemas";

function makeFacts(overrides: Partial<BusinessFacts> = {}): BusinessFacts {
  return {
    businessName: "Glow Dental",
    timezone: "Asia/Singapore",
    locations: [{ name: "Main", address: "123 Orchard Rd" }],
    openingHours: {
      monday: { open: "09:00", close: "18:00", closed: false },
    },
    services: [{ name: "Cleaning", description: "Standard teeth cleaning", currency: "SGD" }],
    escalationContact: { name: "Dr Tan", channel: "whatsapp" as const, address: "+6591234567" },
    additionalFaqs: [],
    ...overrides,
  };
}

function makePrisma() {
  return {
    businessConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

describe("PrismaBusinessFactsStore", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let store: PrismaBusinessFactsStore;

  beforeEach(() => {
    prisma = makePrisma();
    store = new PrismaBusinessFactsStore(prisma as never);
  });

  describe("get", () => {
    it("returns null when no config exists", async () => {
      prisma.businessConfig.findUnique.mockResolvedValue(null);
      const result = await store.get("org_1");
      expect(result).toBeNull();
      expect(prisma.businessConfig.findUnique).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
      });
    });

    it("returns parsed BusinessFacts when config exists", async () => {
      const facts = makeFacts();
      prisma.businessConfig.findUnique.mockResolvedValue({
        id: "bc_1",
        organizationId: "org_1",
        config: facts,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await store.get("org_1");
      expect(result).toEqual(facts);
    });
  });

  describe("upsert", () => {
    it("upserts business facts into config column", async () => {
      const facts = makeFacts();
      prisma.businessConfig.upsert.mockResolvedValue({});
      await store.upsert("org_1", facts);
      expect(prisma.businessConfig.upsert).toHaveBeenCalledWith({
        where: { organizationId: "org_1" },
        create: { organizationId: "org_1", config: facts },
        update: { config: facts },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/db test -- --run -t "PrismaBusinessFactsStore"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PrismaBusinessFactsStore**

Create `packages/db/src/stores/prisma-business-facts-store.ts`:

```typescript
import type { PrismaClient } from "@prisma/client";
import type { BusinessFacts } from "@switchboard/schemas";

export class PrismaBusinessFactsStore {
  constructor(private prisma: PrismaClient) {}

  async get(organizationId: string): Promise<BusinessFacts | null> {
    const row = await this.prisma.businessConfig.findUnique({
      where: { organizationId },
    });
    if (!row) return null;
    return row.config as unknown as BusinessFacts;
  }

  async upsert(organizationId: string, facts: BusinessFacts): Promise<void> {
    await this.prisma.businessConfig.upsert({
      where: { organizationId },
      create: { organizationId, config: facts as object },
      update: { config: facts as object },
    });
  }
}
```

- [ ] **Step 4: Export from db index**

Add to `packages/db/src/index.ts` after the `PrismaReconciliationStore` export (line 95):

```typescript
export { PrismaBusinessFactsStore } from "./stores/prisma-business-facts-store.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/db test -- --run -t "PrismaBusinessFactsStore"`
Expected: PASS — all 3 tests

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/stores/prisma-business-facts-store.ts packages/db/src/stores/__tests__/prisma-business-facts-store.test.ts packages/db/src/index.ts && git commit -m "$(cat <<'EOF'
feat: add PrismaBusinessFactsStore for structured business knowledge

Reads/writes BusinessFacts from the existing BusinessConfig table's
JSON config column, scoped by organizationId.
EOF
)"
```

---

### Task 4: Business Facts Context Resolution

**Files:**

- Modify: `packages/core/src/skill-runtime/context-resolver.ts`
- Modify: `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/skill-runtime/__tests__/context-resolver.test.ts`:

```typescript
import type { BusinessFacts } from "@switchboard/schemas";

function makeFacts(): BusinessFacts {
  return {
    businessName: "Glow Dental",
    timezone: "Asia/Singapore",
    locations: [{ name: "Main", address: "123 Orchard Rd", parkingNotes: "Basement parking" }],
    openingHours: {
      monday: { open: "09:00", close: "18:00", closed: false },
      sunday: { open: "09:00", close: "18:00", closed: true },
    },
    services: [
      {
        name: "Cleaning",
        description: "Standard teeth cleaning",
        durationMinutes: 30,
        price: "150",
        currency: "SGD",
      },
    ],
    bookingPolicies: { cancellationPolicy: "24 hours notice required" },
    escalationContact: { name: "Dr Tan", channel: "whatsapp" as const, address: "+6591234567" },
    additionalFaqs: [
      { question: "Do you have parking?", answer: "Yes, basement parking available" },
    ],
  };
}

function mockBusinessFactsStore(facts: BusinessFacts | null) {
  return { get: vi.fn().mockResolvedValue(facts) };
}

describe("ContextResolverImpl — business-facts", () => {
  it("resolves business-facts from BusinessFactsStore", async () => {
    const facts = makeFacts();
    const factsStore = mockBusinessFactsStore(facts);
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store, factsStore);

    const result = await resolver.resolve("org_test", [
      {
        kind: "business-facts" as KnowledgeKind,
        scope: "operator-approved",
        injectAs: "BUSINESS_FACTS",
        required: true,
      },
    ]);

    expect(result.variables.BUSINESS_FACTS).toContain("Glow Dental");
    expect(result.variables.BUSINESS_FACTS).toContain("123 Orchard Rd");
    expect(result.variables.BUSINESS_FACTS).toContain("09:00");
    expect(result.variables.BUSINESS_FACTS).toContain("Cleaning");
    expect(result.variables.BUSINESS_FACTS).toContain("150 SGD");
    expect(result.variables.BUSINESS_FACTS).toContain("Dr Tan");
    expect(result.variables.BUSINESS_FACTS).toContain("Do you have parking?");
    expect(factsStore.get).toHaveBeenCalledWith("org_test");
  });

  it("throws ContextResolutionError when business-facts required but missing", async () => {
    const factsStore = mockBusinessFactsStore(null);
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store, factsStore);

    await expect(
      resolver.resolve("org_test", [
        {
          kind: "business-facts" as KnowledgeKind,
          scope: "operator-approved",
          injectAs: "BUSINESS_FACTS",
          required: true,
        },
      ]),
    ).rejects.toThrow(ContextResolutionError);
  });

  it("omits business-facts variable when optional and missing", async () => {
    const factsStore = mockBusinessFactsStore(null);
    const store = mockStore([]);
    const resolver = new ContextResolverImpl(store, factsStore);

    const result = await resolver.resolve("org_test", [
      {
        kind: "business-facts" as KnowledgeKind,
        scope: "operator-approved",
        injectAs: "BUSINESS_FACTS",
        required: false,
      },
    ]);

    expect(result.variables).not.toHaveProperty("BUSINESS_FACTS");
  });

  it("resolves business-facts alongside other kinds", async () => {
    const facts = makeFacts();
    const factsStore = mockBusinessFactsStore(facts);
    const store = mockStore([
      {
        kind: "playbook" as KnowledgeKind,
        scope: "objection-handling",
        content: "Playbook text",
        priority: 0,
        updatedAt: new Date(),
      },
    ]);
    const resolver = new ContextResolverImpl(store, factsStore);

    const result = await resolver.resolve("org_test", [
      {
        kind: "playbook" as KnowledgeKind,
        scope: "objection-handling",
        injectAs: "PLAYBOOK_CONTEXT",
        required: true,
      },
      {
        kind: "business-facts" as KnowledgeKind,
        scope: "operator-approved",
        injectAs: "BUSINESS_FACTS",
        required: true,
      },
    ]);

    expect(result.variables.PLAYBOOK_CONTEXT).toBe("Playbook text");
    expect(result.variables.BUSINESS_FACTS).toContain("Glow Dental");
    expect(result.metadata).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run -t "business-facts"`
Expected: FAIL — `ContextResolverImpl` constructor doesn't accept second argument

- [ ] **Step 3: Update ContextResolverImpl**

Replace `packages/core/src/skill-runtime/context-resolver.ts` with:

```typescript
import type { ContextRequirement, KnowledgeKind, BusinessFacts } from "@switchboard/schemas";
import { ContextResolutionError } from "./types.js";

export interface ContextResolutionMeta {
  injectAs: string;
  kind: KnowledgeKind;
  scope: string;
  entriesFound: number;
  totalChars: number;
}

export interface ResolvedContext {
  variables: Record<string, string>;
  metadata: ContextResolutionMeta[];
}

interface KnowledgeEntryRow {
  kind: KnowledgeKind;
  scope: string;
  content: string;
  priority: number;
  updatedAt: Date;
}

export interface KnowledgeEntryStoreForResolver {
  findActive(
    orgId: string,
    filters: Array<{ kind: KnowledgeKind; scope: string }>,
  ): Promise<KnowledgeEntryRow[]>;
}

export interface BusinessFactsStoreForResolver {
  get(organizationId: string): Promise<BusinessFacts | null>;
}

export class ContextResolverImpl {
  constructor(
    private store: KnowledgeEntryStoreForResolver,
    private businessFactsStore?: BusinessFactsStoreForResolver,
  ) {}

  async resolve(orgId: string, requirements: ContextRequirement[]): Promise<ResolvedContext> {
    if (requirements.length === 0) {
      return { variables: {}, metadata: [] };
    }

    const businessFactsReqs = requirements.filter((r) => r.kind === "business-facts");
    const knowledgeReqs = requirements.filter((r) => r.kind !== "business-facts");

    const variables: Record<string, string> = {};
    const metadata: ContextResolutionMeta[] = [];

    if (businessFactsReqs.length > 0) {
      await this.resolveBusinessFacts(orgId, businessFactsReqs, variables, metadata);
    }

    if (knowledgeReqs.length > 0) {
      await this.resolveKnowledge(orgId, knowledgeReqs, variables, metadata);
    }

    return { variables, metadata };
  }

  private async resolveBusinessFacts(
    orgId: string,
    reqs: ContextRequirement[],
    variables: Record<string, string>,
    metadata: ContextResolutionMeta[],
  ): Promise<void> {
    const facts = this.businessFactsStore ? await this.businessFactsStore.get(orgId) : null;

    for (const req of reqs) {
      if (!facts) {
        if (req.required) {
          throw new ContextResolutionError(req.kind, req.scope);
        }
        metadata.push({
          injectAs: req.injectAs,
          kind: req.kind,
          scope: req.scope,
          entriesFound: 0,
          totalChars: 0,
        });
        continue;
      }

      const rendered = renderBusinessFacts(facts);
      variables[req.injectAs] = rendered;
      metadata.push({
        injectAs: req.injectAs,
        kind: req.kind,
        scope: req.scope,
        entriesFound: 1,
        totalChars: rendered.length,
      });
    }
  }

  private async resolveKnowledge(
    orgId: string,
    reqs: ContextRequirement[],
    variables: Record<string, string>,
    metadata: ContextResolutionMeta[],
  ): Promise<void> {
    const filters = reqs.map((r) => ({ kind: r.kind, scope: r.scope }));
    const entries = await this.store.findActive(orgId, filters);

    const grouped = new Map<string, KnowledgeEntryRow[]>();
    for (const entry of entries) {
      const key = `${entry.kind}::${entry.scope}`;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    for (const req of reqs) {
      const key = `${req.kind}::${req.scope}`;
      const group = grouped.get(key) ?? [];
      const concatenated = group.map((e) => e.content).join("\n---\n");

      if (group.length === 0 && req.required) {
        throw new ContextResolutionError(req.kind, req.scope);
      }

      if (group.length > 0) {
        variables[req.injectAs] = concatenated;
      }

      metadata.push({
        injectAs: req.injectAs,
        kind: req.kind,
        scope: req.scope,
        entriesFound: group.length,
        totalChars: concatenated.length,
      });
    }
  }
}

function renderBusinessFacts(facts: BusinessFacts): string {
  const lines: string[] = [];
  lines.push("## Business Facts (Operator-Approved — answer ONLY from these facts)");
  lines.push("");
  lines.push(`**Business:** ${facts.businessName}`);
  lines.push(`**Timezone:** ${facts.timezone}`);
  lines.push("");

  lines.push("### Locations");
  for (const loc of facts.locations) {
    lines.push(`- ${loc.name}: ${loc.address}`);
    if (loc.parkingNotes) lines.push(`  Parking: ${loc.parkingNotes}`);
    if (loc.accessNotes) lines.push(`  Access: ${loc.accessNotes}`);
  }
  lines.push("");

  lines.push("### Opening Hours");
  for (const [day, hours] of Object.entries(facts.openingHours)) {
    if (hours.closed) {
      lines.push(`- ${day}: Closed`);
    } else {
      lines.push(`- ${day}: ${hours.open} - ${hours.close}`);
    }
  }
  lines.push("");

  lines.push("### Services");
  for (const svc of facts.services) {
    lines.push(`- ${svc.name}: ${svc.description}`);
    if (svc.durationMinutes) lines.push(`  Duration: ${svc.durationMinutes} min`);
    if (svc.price) lines.push(`  Price: ${svc.price} ${svc.currency ?? "SGD"}`);
  }
  lines.push("");

  if (facts.bookingPolicies) {
    lines.push("### Booking Policies");
    const bp = facts.bookingPolicies;
    if (bp.cancellationPolicy) lines.push(`- Cancellation: ${bp.cancellationPolicy}`);
    if (bp.reschedulePolicy) lines.push(`- Reschedule: ${bp.reschedulePolicy}`);
    if (bp.noShowPolicy) lines.push(`- No-show: ${bp.noShowPolicy}`);
    if (bp.advanceBookingDays) lines.push(`- Advance booking: ${bp.advanceBookingDays} days`);
    if (bp.prepInstructions) lines.push(`- Preparation: ${bp.prepInstructions}`);
    lines.push("");
  }

  lines.push("### Escalation Contact");
  lines.push(
    `${facts.escalationContact.name} via ${facts.escalationContact.channel}: ${facts.escalationContact.address}`,
  );
  lines.push("");

  if (facts.additionalFaqs.length > 0) {
    lines.push("### Additional FAQs");
    for (const faq of facts.additionalFaqs) {
      lines.push(`Q: ${faq.question}`);
      lines.push(`A: ${faq.answer}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run -t "business-facts"`
Expected: PASS — all 4 new tests pass

- [ ] **Step 5: Run existing context-resolver tests to verify no regressions**

Run: `pnpm --filter @switchboard/core test -- --run -t "ContextResolverImpl"`
Expected: PASS — existing tests should still work since the second constructor arg is optional

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skill-runtime/context-resolver.ts packages/core/src/skill-runtime/__tests__/context-resolver.test.ts && git commit -m "$(cat <<'EOF'
feat: resolve business-facts context kind from BusinessFactsStore

ContextResolverImpl now accepts an optional BusinessFactsStoreForResolver.
When a skill requires kind=business-facts, it loads structured facts
and renders them as a formatted prompt section instead of RAG lookup.
EOF
)"
```

---

### Task 5: Business Facts API Route

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts`

- [ ] **Step 1: Create the API route**

Create `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { getApiClient } from "@/lib/get-api-client";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const deployment = await client.getDeployment(id);
    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }
    const facts = await client.getBusinessFacts(deployment.organizationId);
    return NextResponse.json({ facts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const client = await getApiClient();
    const deployment = await client.getDeployment(id);
    if (!deployment) {
      return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = BusinessFactsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await client.upsertBusinessFacts(deployment.organizationId, parsed.data);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Unauthorized" ? 401 : 500 },
    );
  }
}
```

Note: The `getBusinessFacts` and `upsertBusinessFacts` methods on the API client may need to be added to the `SwitchboardClient` class. Check `apps/dashboard/src/lib/get-api-client.ts` and the Switchboard API routes — if they don't exist yet, add corresponding API endpoints in `apps/api/src/routes/` and client methods. This follows the same thin-proxy pattern as all other dashboard API routes.

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/app/api/dashboard/marketplace/deployments/\[id\]/business-facts/route.ts && git commit -m "$(cat <<'EOF'
feat: add business facts API route for dashboard

GET/PUT endpoints for reading and updating operator-managed business
facts, scoped to deployment's organization. Validates via BusinessFactsSchema.
EOF
)"
```

---

### Task 6: Business Facts Dashboard Form Component

**Files:**

- Create: `apps/dashboard/src/components/marketplace/business-facts-form.tsx`

- [ ] **Step 1: Create the form component**

Create `apps/dashboard/src/components/marketplace/business-facts-form.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import type { BusinessFacts } from "@switchboard/schemas";

interface BusinessFactsFormProps {
  initialFacts?: Partial<BusinessFacts>;
  onSave: (facts: BusinessFacts) => void;
  isSaving?: boolean;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const DEFAULT_FACTS: BusinessFacts = {
  businessName: "",
  timezone: "Asia/Singapore",
  locations: [{ name: "", address: "" }],
  openingHours: Object.fromEntries(
    DAYS.map((d) => [d, { open: "09:00", close: "18:00", closed: false }]),
  ),
  services: [{ name: "", description: "", currency: "SGD" }],
  escalationContact: { name: "", channel: "whatsapp", address: "" },
  additionalFaqs: [],
};

export function BusinessFactsForm({ initialFacts, onSave, isSaving }: BusinessFactsFormProps) {
  const [facts, setFacts] = useState<BusinessFacts>({
    ...DEFAULT_FACTS,
    ...initialFacts,
  } as BusinessFacts);

  const updateField = useCallback(
    <K extends keyof BusinessFacts>(key: K, value: BusinessFacts[K]) => {
      setFacts((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const addLocation = useCallback(() => {
    setFacts((prev) => ({
      ...prev,
      locations: [...prev.locations, { name: "", address: "" }],
    }));
  }, []);

  const removeLocation = useCallback((index: number) => {
    setFacts((prev) => ({
      ...prev,
      locations: prev.locations.filter((_, i) => i !== index),
    }));
  }, []);

  const updateLocation = useCallback((index: number, field: string, value: string) => {
    setFacts((prev) => ({
      ...prev,
      locations: prev.locations.map((loc, i) => (i === index ? { ...loc, [field]: value } : loc)),
    }));
  }, []);

  const addService = useCallback(() => {
    setFacts((prev) => ({
      ...prev,
      services: [...prev.services, { name: "", description: "", currency: "SGD" }],
    }));
  }, []);

  const removeService = useCallback((index: number) => {
    setFacts((prev) => ({
      ...prev,
      services: prev.services.filter((_, i) => i !== index),
    }));
  }, []);

  const updateService = useCallback((index: number, field: string, value: string | number) => {
    setFacts((prev) => ({
      ...prev,
      services: prev.services.map((svc, i) => (i === index ? { ...svc, [field]: value } : svc)),
    }));
  }, []);

  const updateHours = useCallback((day: string, field: string, value: string | boolean) => {
    setFacts((prev) => ({
      ...prev,
      openingHours: {
        ...prev.openingHours,
        [day]: { ...prev.openingHours[day], [field]: value },
      },
    }));
  }, []);

  const addFaq = useCallback(() => {
    setFacts((prev) => ({
      ...prev,
      additionalFaqs: [...prev.additionalFaqs, { question: "", answer: "" }],
    }));
  }, []);

  const removeFaq = useCallback((index: number) => {
    setFacts((prev) => ({
      ...prev,
      additionalFaqs: prev.additionalFaqs.filter((_, i) => i !== index),
    }));
  }, []);

  const updateFaq = useCallback((index: number, field: "question" | "answer", value: string) => {
    setFacts((prev) => ({
      ...prev,
      additionalFaqs: prev.additionalFaqs.map((faq, i) =>
        i === index ? { ...faq, [field]: value } : faq,
      ),
    }));
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSave(facts);
    },
    [facts, onSave],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Business Identity */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Business Identity</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Business Name *</label>
            <input
              type="text"
              value={facts.businessName}
              onChange={(e) => updateField("businessName", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Timezone</label>
            <input
              type="text"
              value={facts.timezone}
              onChange={(e) => updateField("timezone", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Locations */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Locations *</h3>
          <button
            type="button"
            onClick={addLocation}
            className="text-sm text-primary hover:underline"
          >
            + Add location
          </button>
        </div>
        {facts.locations.map((loc, i) => (
          <div key={i} className="border rounded-lg p-4 mb-3 space-y-3">
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 gap-3 flex-1">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={loc.name}
                    onChange={(e) => updateLocation(i, "name", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Address *</label>
                  <input
                    type="text"
                    value={loc.address}
                    onChange={(e) => updateLocation(i, "address", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              {facts.locations.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLocation(i)}
                  className="ml-2 text-sm text-destructive hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Parking Notes</label>
                <input
                  type="text"
                  value={loc.parkingNotes ?? ""}
                  onChange={(e) => updateLocation(i, "parkingNotes", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Basement parking available"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Access Notes</label>
                <input
                  type="text"
                  value={loc.accessNotes ?? ""}
                  onChange={(e) => updateLocation(i, "accessNotes", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. Take lift to level 3"
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Opening Hours */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Opening Hours *</h3>
        <div className="space-y-2">
          {DAYS.map((day) => {
            const hours = facts.openingHours[day] ?? {
              open: "09:00",
              close: "18:00",
              closed: false,
            };
            return (
              <div key={day} className="flex items-center gap-3">
                <span className="w-28 text-sm capitalize">{day}</span>
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={hours.closed}
                    onChange={(e) => updateHours(day, "closed", e.target.checked)}
                  />
                  Closed
                </label>
                {!hours.closed && (
                  <>
                    <input
                      type="time"
                      value={hours.open}
                      onChange={(e) => updateHours(day, "open", e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                    />
                    <span className="text-sm">to</span>
                    <input
                      type="time"
                      value={hours.close}
                      onChange={(e) => updateHours(day, "close", e.target.value)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Services */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Services *</h3>
          <button
            type="button"
            onClick={addService}
            className="text-sm text-primary hover:underline"
          >
            + Add service
          </button>
        </div>
        {facts.services.map((svc, i) => (
          <div key={i} className="border rounded-lg p-4 mb-3 space-y-3">
            <div className="flex justify-between items-start">
              <div className="grid grid-cols-2 gap-3 flex-1">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={svc.name}
                    onChange={(e) => updateService(i, "name", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description *</label>
                  <input
                    type="text"
                    value={svc.description}
                    onChange={(e) => updateService(i, "description", e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>
              {facts.services.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeService(i)}
                  className="ml-2 text-sm text-destructive hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Duration (min)</label>
                <input
                  type="number"
                  value={svc.durationMinutes ?? ""}
                  onChange={(e) =>
                    updateService(i, "durationMinutes", parseInt(e.target.value) || 0)
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Price</label>
                <input
                  type="text"
                  value={svc.price ?? ""}
                  onChange={(e) => updateService(i, "price", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. 150"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <input
                  type="text"
                  value={svc.currency ?? "SGD"}
                  onChange={(e) => updateService(i, "currency", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Booking Policies */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Booking Policies</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Cancellation Policy</label>
            <textarea
              value={facts.bookingPolicies?.cancellationPolicy ?? ""}
              onChange={(e) =>
                updateField("bookingPolicies", {
                  ...facts.bookingPolicies,
                  cancellationPolicy: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reschedule Policy</label>
            <textarea
              value={facts.bookingPolicies?.reschedulePolicy ?? ""}
              onChange={(e) =>
                updateField("bookingPolicies", {
                  ...facts.bookingPolicies,
                  reschedulePolicy: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Preparation Instructions</label>
            <textarea
              value={facts.bookingPolicies?.prepInstructions ?? ""}
              onChange={(e) =>
                updateField("bookingPolicies", {
                  ...facts.bookingPolicies,
                  prepInstructions: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
              placeholder="e.g. Brush your teeth before arriving"
            />
          </div>
        </div>
      </section>

      {/* Escalation Contact */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Escalation Contact *</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={facts.escalationContact.name}
              onChange={(e) =>
                updateField("escalationContact", {
                  ...facts.escalationContact,
                  name: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Channel *</label>
            <select
              value={facts.escalationContact.channel}
              onChange={(e) =>
                updateField("escalationContact", {
                  ...facts.escalationContact,
                  channel: e.target.value as "whatsapp" | "telegram" | "email" | "sms",
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address *</label>
            <input
              type="text"
              value={facts.escalationContact.address}
              onChange={(e) =>
                updateField("escalationContact", {
                  ...facts.escalationContact,
                  address: e.target.value,
                })
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              required
              placeholder="e.g. +6591234567"
            />
          </div>
        </div>
      </section>

      {/* Additional FAQs */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Additional FAQs</h3>
          <button type="button" onClick={addFaq} className="text-sm text-primary hover:underline">
            + Add FAQ
          </button>
        </div>
        {facts.additionalFaqs.map((faq, i) => (
          <div key={i} className="border rounded-lg p-4 mb-3 space-y-2">
            <div className="flex justify-between">
              <label className="block text-sm font-medium mb-1">Question</label>
              <button
                type="button"
                onClick={() => removeFaq(i)}
                className="text-sm text-destructive hover:underline"
              >
                Remove
              </button>
            </div>
            <input
              type="text"
              value={faq.question}
              onChange={(e) => updateFaq(i, "question", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <label className="block text-sm font-medium mb-1">Answer</label>
            <textarea
              value={faq.answer}
              onChange={(e) => updateFaq(i, "answer", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={2}
            />
          </div>
        ))}
      </section>

      <div className="pt-4 border-t">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Business Facts"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/components/marketplace/business-facts-form.tsx && git commit -m "$(cat <<'EOF'
feat: add BusinessFactsForm component for operator knowledge entry

Structured form with repeatable locations, services, FAQs sections,
opening hours grid, booking policies, and escalation contact.
EOF
)"
```

---

### Task 7: Wire Business Facts into Deploy Wizard

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx`
- Modify: `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx` (add `businessFacts` to `WizardData`)

- [ ] **Step 1: Add businessFacts to WizardData**

In `apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx`, add to the `WizardData` interface:

```typescript
import type { BusinessFacts } from "@switchboard/schemas";

// Add to WizardData interface:
businessFacts?: BusinessFacts;
```

- [ ] **Step 2: Create BusinessFactsStep wizard wrapper**

In `apps/dashboard/src/app/(auth)/deploy/[slug]/deploy-wizard-client.tsx`, add:

```typescript
import { BusinessFactsForm } from "@/components/marketplace/business-facts-form";
import { BusinessFactsSchema } from "@switchboard/schemas";
import type { BusinessFacts } from "@switchboard/schemas";
```

Add a step component (inside the file or as a separate inline):

```typescript
function BusinessFactsStep({ data, onUpdate, onNext }: WizardStepProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(
    (facts: BusinessFacts) => {
      const result = BusinessFactsSchema.safeParse(facts);
      if (!result.success) return;
      setIsSaving(true);
      onUpdate({ businessFacts: result.data });
      setIsSaving(false);
      onNext();
    },
    [onUpdate, onNext],
  );

  const prefilled = data.scannedProfile
    ? prefillFromScan(data.scannedProfile)
    : undefined;

  return (
    <div>
      <h3 className="text-lg font-semibold mb-2">Business Facts</h3>
      <p className="text-sm text-muted-foreground mb-6">
        These facts determine what Alex can answer. Missing facts will trigger escalation to your team.
      </p>
      <BusinessFactsForm
        initialFacts={data.businessFacts ?? prefilled}
        onSave={handleSave}
        isSaving={isSaving}
      />
    </div>
  );
}

function prefillFromScan(scanned: Record<string, unknown>): Partial<BusinessFacts> {
  const result: Partial<BusinessFacts> = {};
  if (typeof scanned["businessName"] === "string") {
    result.businessName = scanned["businessName"] as string;
  }
  if (Array.isArray(scanned["products"])) {
    result.services = (scanned["products"] as Array<{ name: string; description: string; price?: string }>).map(
      (p) => ({ name: p.name, description: p.description, price: p.price, currency: "SGD" }),
    );
  }
  if (scanned["location"] && typeof scanned["location"] === "object") {
    const loc = scanned["location"] as { address?: string; city?: string };
    result.locations = [{ name: "Main", address: [loc.address, loc.city].filter(Boolean).join(", ") }];
  }
  if (scanned["hours"] && typeof scanned["hours"] === "object") {
    const hours = scanned["hours"] as Record<string, string>;
    result.openingHours = Object.fromEntries(
      Object.entries(hours).map(([day, val]) => {
        const match = val.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        return [day, match ? { open: match[1]!, close: match[2]!, closed: false } : { open: "09:00", close: "18:00", closed: false }];
      }),
    );
  }
  if (Array.isArray(scanned["faqs"])) {
    result.additionalFaqs = (scanned["faqs"] as Array<{ question: string; answer: string }>);
  }
  return result;
}
```

- [ ] **Step 3: Add the business-facts step to the wizard flow**

In the `steps` memo inside `DeployWizardClient`, add the business facts step after `review-scan` and before `review`:

```typescript
// After the review-scan step push and before the review step push:
allSteps.push({
  id: "business-facts",
  label: "Business facts",
  component: BusinessFactsStep as unknown as WizardStep["component"],
});
```

- [ ] **Step 4: Add deployment gate in handleDeploy**

In `handleDeploy`, add a guard before the fetch call:

```typescript
const data = wizardDataRef.current;
if (!data.businessFacts) {
  setError("Business facts are required before deploying.");
  return;
}
```

And include `businessFacts` in the onboard request body:

```typescript
      body: JSON.stringify({
        listingId,
        businessName: data.persona?.businessName ?? data.businessFacts?.businessName ?? "My Business",
        setupAnswers: data.persona ?? {},
        scannedProfile: data.scannedProfile ?? null,
        businessFacts: data.businessFacts,
      }),
```

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/\(auth\)/deploy/\[slug\]/deploy-wizard-client.tsx apps/dashboard/src/components/marketplace/deploy-wizard-shell.tsx && git commit -m "$(cat <<'EOF'
feat: wire business facts step into deploy wizard with deployment gate

Adds a Business Facts step between scan review and persona review.
Pre-fills from website scanner output. Blocks deployment if facts are
missing — Alex cannot go live without operator-approved knowledge.
EOF
)"
```

---

### Task 8: Update Alex Skill — Context + Grounding Rules

**Files:**

- Modify: `skills/alex.md`

- [ ] **Step 1: Update context block in frontmatter**

In `skills/alex.md`, replace the context section (lines 46-60):

```yaml
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: POLICY_CONTEXT
  - kind: business-facts
    scope: operator-approved
    inject_as: BUSINESS_FACTS
    required: true
  - kind: playbook
    scope: qualification-framework
    inject_as: QUALIFICATION_CONTEXT
```

- [ ] **Step 2: Add Operating Boundaries section**

After the `## Local Tone (Singapore English)` section (line 86) and before `## Conversation Flow` (line 88), add:

```markdown
## Operating Boundaries

You operate in three modes. The customer should never notice these — it's all one conversation.

**Bucket A — You handle directly:**

- Booking flow (finding slots, confirming appointments)
- Service basics mentioned in Business Facts
- Simple FAQ from the Additional FAQs section
- Qualifying the lead through conversation

**Bucket B — Answer only from Business Facts:**

- Hours, pricing, parking, prep instructions, policies, eligibility
- If the fact exists in Business Facts, answer it
- If the fact is NOT in Business Facts, escalate (Bucket C)
- Never improvise, guess, or say "probably"

**Bucket C — Escalate to human:**

- Missing business knowledge (fact not in Business Facts)
- Complaints, refunds, exceptions
- Angry or frustrated customers
- Custom packages or pricing exceptions
- Medical/service questions beyond basic info
- Anything you're not confident about

When in doubt, escalate. A polite handoff is always better than a wrong answer.
```

- [ ] **Step 3: Replace Available Services section with Business Facts**

Replace the `## Available Services` section (line 193-194) and its `{{KNOWLEDGE_CONTEXT}}` reference with:

```markdown
## Business Facts

{{BUSINESS_FACTS}}

## Business Knowledge Rules

You have access to operator-approved business facts above. Follow these rules strictly:

1. **If the customer asks about hours, pricing, services, policies, parking, prep, or any business fact:**
   - Answer ONLY from the Business Facts section above
   - If the answer is not in the Business Facts, do NOT guess or improvise
   - Instead, say: "I'm not certain about that detail. Let me get a team member to confirm for you."
   - Then escalate to Bucket C

2. **Never say "probably", "I think", or "usually" about business facts.**
   A wrong answer about pricing or policy is worse than a polite escalation.

3. **Safe conversational bridges are allowed:**
   - "I'm not sure about that detail."
   - "A team member can confirm that for you."
   - "I can still help you find a booking slot in the meantime."
     These are NOT factual claims. They are safe transitions.
```

- [ ] **Step 4: Commit**

```bash
git add skills/alex.md && git commit -m "$(cat <<'EOF'
feat: add bucket routing + grounding rules to Alex skill

Replaces RAG-based KNOWLEDGE_CONTEXT with structured BUSINESS_FACTS.
Adds three-bucket operating boundaries: handle, grounded, escalate.
Business knowledge rules enforce no-improvisation policy.
EOF
)"
```

---

### Task 9: Wire BusinessFactsStore into ContextResolver at Bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Import and wire BusinessFactsStore**

In `apps/api/src/bootstrap/skill-mode.ts`, update the dynamic imports (around line 24-27):

```typescript
const {
  PrismaContactStore,
  PrismaOpportunityStore,
  PrismaActivityLogStore,
  PrismaBookingStore,
  PrismaBusinessFactsStore,
} = await import("@switchboard/db");
```

After the store instantiations (around line 42), add:

```typescript
const businessFactsStore = new PrismaBusinessFactsStore(prismaClient);
```

Then wire it into the `ContextResolverImpl` — find where the context resolver is used. Check if `SkillMode` or `SkillExecutorImpl` constructs it. If the `ContextResolverImpl` is constructed in `SkillMode`, pass `businessFactsStore` as the second argument.

Note: The exact wiring depends on how `ContextResolverImpl` is currently instantiated. Check `packages/core/src/platform/modes/skill-mode.ts` for the construction site. The resolver needs the `businessFactsStore` passed as its second constructor argument.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts && git commit -m "$(cat <<'EOF'
feat: wire PrismaBusinessFactsStore into skill-mode bootstrap

Context resolver now receives the business facts store for resolving
kind=business-facts context requirements from structured operator data.
EOF
)"
```

---

### Task 10: Slice 1 Verification

- [ ] **Step 1: Run all package tests**

```bash
pnpm test -- --run
```

Expected: PASS — all tests across all packages

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS — no type errors

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: PASS — no lint errors

---

## Slice 2: Bucket C — Wired Escalation

### Task 11: Add `missing_knowledge` to HandoffReason

**Files:**

- Modify: `packages/core/src/handoff/types.ts:6-13`

- [ ] **Step 1: Update the type**

In `packages/core/src/handoff/types.ts`, change `HandoffReason` to:

```typescript
export type HandoffReason =
  | "human_requested"
  | "max_turns_exceeded"
  | "complex_objection"
  | "negative_sentiment"
  | "compliance_concern"
  | "booking_failure"
  | "escalation_timeout"
  | "missing_knowledge";
```

- [ ] **Step 2: Run typecheck to verify no breaks**

```bash
pnpm typecheck
```

Expected: PASS — adding a union member is backwards compatible

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/handoff/types.ts && git commit -m "$(cat <<'EOF'
feat: add missing_knowledge to HandoffReason type

New escalation reason for when Alex cannot find a business fact in the
operator-approved knowledge store. Triggers human handoff.
EOF
)"
```

---

### Task 12: Create Escalate Tool

**Files:**

- Create: `packages/core/src/skill-runtime/tools/escalate.ts`
- Create: `packages/core/src/skill-runtime/tools/escalate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/skill-runtime/tools/escalate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEscalateTool } from "./escalate.js";
import type { HandoffReason } from "../../handoff/types.js";

function makeDeps() {
  return {
    assembler: {
      assemble: vi.fn().mockReturnValue({
        id: "handoff_123",
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge" as HandoffReason,
        status: "pending" as const,
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        conversationSummary: {
          turnCount: 3,
          keyTopics: [],
          objectionHistory: [],
          sentiment: "neutral",
        },
        slaDeadlineAt: new Date(),
        createdAt: new Date(),
      }),
    },
    handoffStore: {
      save: vi.fn().mockResolvedValue(undefined),
      getBySessionId: vi.fn().mockResolvedValue(null),
    },
    notifier: {
      notify: vi.fn().mockResolvedValue(undefined),
    },
    sessionContext: {
      sessionId: "sess_1",
      organizationId: "org_1",
      leadSnapshot: { channel: "whatsapp" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
      messages: [],
    },
  };
}

describe("escalate tool", () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("has id 'escalate'", () => {
    const tool = createEscalateTool(deps);
    expect(tool.id).toBe("escalate");
  });

  it("has handoff.create operation with governanceTier write", () => {
    const tool = createEscalateTool(deps);
    expect(tool.operations["handoff.create"]).toBeDefined();
    expect(tool.operations["handoff.create"]!.governanceTier).toBe("write");
  });

  it("creates a handoff package and notifies", async () => {
    const tool = createEscalateTool(deps);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "Customer asked about parking, no data available",
      customerSentiment: "neutral",
    });

    expect(deps.assembler.assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess_1",
        organizationId: "org_1",
        reason: "missing_knowledge",
      }),
    );
    expect(deps.handoffStore.save).toHaveBeenCalled();
    expect(deps.notifier.notify).toHaveBeenCalled();
    expect(result).toEqual({ handoffId: "handoff_123", status: "pending" });
  });

  it("returns existing handoff if one is pending for same session (duplicate guard)", async () => {
    deps.handoffStore.getBySessionId.mockResolvedValue({
      id: "handoff_existing",
      status: "pending",
    });
    const tool = createEscalateTool(deps);
    const result = await tool.operations["handoff.create"]!.execute({
      reason: "missing_knowledge",
      summary: "duplicate attempt",
    });

    expect(deps.assembler.assemble).not.toHaveBeenCalled();
    expect(deps.handoffStore.save).not.toHaveBeenCalled();
    expect(result).toEqual({ handoffId: "handoff_existing", status: "already_pending" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/core test -- --run -t "escalate tool"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the escalate tool**

Create `packages/core/src/skill-runtime/tools/escalate.ts`:

```typescript
import type { SkillTool } from "../types.js";
import type { HandoffPackageAssembler, AssemblerInput } from "../../handoff/package-assembler.js";
import type {
  HandoffReason,
  HandoffStore,
  LeadSnapshot,
  QualificationSnapshot,
} from "../../handoff/types.js";
import type { HandoffNotifier } from "../../handoff/handoff-notifier.js";

interface EscalateToolDeps {
  assembler: { assemble(input: AssemblerInput): ReturnType<HandoffPackageAssembler["assemble"]> };
  handoffStore: Pick<HandoffStore, "save" | "getBySessionId">;
  notifier: { notify(pkg: Parameters<HandoffNotifier["notify"]>[0]): Promise<void> };
  sessionContext: {
    sessionId: string;
    organizationId: string;
    leadSnapshot: LeadSnapshot;
    qualificationSnapshot: QualificationSnapshot;
    messages: Array<{ role: string; text: string }>;
  };
}

interface EscalateInput {
  reason: HandoffReason;
  summary: string;
  customerSentiment?: "positive" | "neutral" | "frustrated" | "angry";
}

export function createEscalateTool(deps: EscalateToolDeps): SkillTool {
  return {
    id: "escalate",
    operations: {
      "handoff.create": {
        description:
          "Escalate the conversation to a human team member. Use when the customer's question is outside your scope, when business knowledge is missing, or when the customer is frustrated.",
        governanceTier: "write" as const,
        idempotent: false,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              enum: [
                "human_requested",
                "missing_knowledge",
                "complex_objection",
                "negative_sentiment",
                "compliance_concern",
                "booking_failure",
                "max_turns_exceeded",
              ],
            },
            summary: {
              type: "string",
              description: "Brief summary of why escalation is needed and what the customer wants",
            },
            customerSentiment: {
              type: "string",
              enum: ["positive", "neutral", "frustrated", "angry"],
            },
          },
          required: ["reason", "summary"],
        },
        execute: async (params: unknown) => {
          const input = params as EscalateInput;

          const existing = await deps.handoffStore.getBySessionId(deps.sessionContext.sessionId);
          if (existing && (existing.status === "pending" || existing.status === "assigned")) {
            return { handoffId: existing.id, status: "already_pending" };
          }

          const pkg = deps.assembler.assemble({
            sessionId: deps.sessionContext.sessionId,
            organizationId: deps.sessionContext.organizationId,
            reason: input.reason,
            leadSnapshot: deps.sessionContext.leadSnapshot,
            qualificationSnapshot: deps.sessionContext.qualificationSnapshot,
            messages: deps.sessionContext.messages,
          });

          await deps.handoffStore.save(pkg);
          await deps.notifier.notify(pkg);

          return { handoffId: pkg.id, status: "pending" };
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/core test -- --run -t "escalate tool"`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skill-runtime/tools/escalate.ts packages/core/src/skill-runtime/tools/escalate.test.ts && git commit -m "$(cat <<'EOF'
feat: add escalate skill tool for wired human handoff

Creates HandoffPackage via assembler, persists to HandoffStore, and
notifies via HandoffNotifier. Includes duplicate guard — returns
existing handoff ID if one is already pending for the same session.
EOF
)"
```

---

### Task 13: Register Escalate Tool + Remove Pipeline-Handoff

**Files:**

- Modify: `packages/core/src/skill-runtime/tools/index.ts`
- Modify: `packages/core/src/skill-runtime/index.ts`
- Delete: `packages/core/src/skill-runtime/tools/pipeline-handoff.ts`
- Delete: `packages/core/src/skill-runtime/tools/pipeline-handoff.test.ts`

- [ ] **Step 1: Update tool index**

Replace `packages/core/src/skill-runtime/tools/index.ts`:

```typescript
export { createCrmQueryTool } from "./crm-query.js";
export { createCrmWriteTool } from "./crm-write.js";
export { createWebScannerTool } from "./web-scanner.js";
export { createCalendarBookTool } from "./calendar-book.js";
export { createEscalateTool } from "./escalate.js";
```

- [ ] **Step 2: Update skill-runtime index**

In `packages/core/src/skill-runtime/index.ts`, change line 14-19 from:

```typescript
export {
  createCrmQueryTool,
  createCrmWriteTool,
  createCalendarBookTool,
  createPipelineHandoffTool,
  createWebScannerTool,
} from "./tools/index.js";
```

to:

```typescript
export {
  createCrmQueryTool,
  createCrmWriteTool,
  createCalendarBookTool,
  createWebScannerTool,
  createEscalateTool,
} from "./tools/index.js";
```

- [ ] **Step 3: Delete pipeline-handoff files**

```bash
rm packages/core/src/skill-runtime/tools/pipeline-handoff.ts packages/core/src/skill-runtime/tools/pipeline-handoff.test.ts
```

- [ ] **Step 4: Update eval-suite.test.ts**

In `packages/core/src/skill-runtime/__tests__/eval-suite.test.ts`:

Remove the import of `createPipelineHandoffTool` (line 8) and the line that adds it to the tools map (line 125: `tools.set("pipeline-handoff", createPipelineHandoffTool())`).

Add instead:

```typescript
import { createEscalateTool } from "../tools/escalate.js";
```

And in the tools setup, add a mock escalate tool:

```typescript
tools.set(
  "escalate",
  createEscalateTool({
    assembler: {
      assemble: () => ({
        id: "h_1",
        sessionId: "s",
        organizationId: "o",
        reason: "missing_knowledge",
        status: "pending",
        leadSnapshot: { channel: "whatsapp" },
        qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
        conversationSummary: {
          turnCount: 0,
          keyTopics: [],
          objectionHistory: [],
          sentiment: "neutral",
        },
        slaDeadlineAt: new Date(),
        createdAt: new Date(),
      }),
    },
    handoffStore: { save: async () => {}, getBySessionId: async () => null },
    notifier: { notify: async () => {} },
    sessionContext: {
      sessionId: "s",
      organizationId: "o",
      leadSnapshot: { channel: "whatsapp" },
      qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
      messages: [],
    },
  }),
);
```

- [ ] **Step 5: Update sales-pipeline.md skill if needed**

Check `skills/sales-pipeline.md` — if it lists `pipeline-handoff` in its tools, remove it. The sales pipeline skill shouldn't need visible agent handoff either.

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @switchboard/core test -- --run
```

Expected: PASS — no references to deleted files

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/skill-runtime/tools/index.ts packages/core/src/skill-runtime/index.ts packages/core/src/skill-runtime/__tests__/eval-suite.test.ts && git rm packages/core/src/skill-runtime/tools/pipeline-handoff.ts packages/core/src/skill-runtime/tools/pipeline-handoff.test.ts && git commit -m "$(cat <<'EOF'
feat: register escalate tool, retire pipeline-handoff

Replaces visible multi-agent handoff with single-agent escalation.
Pipeline-handoff pointed toward agent-to-agent routing which contradicts
the one-visible-agent model.
EOF
)"
```

---

### Task 14: Wire Escalate Tool into Skill-Mode Bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/skill-mode.ts`

- [ ] **Step 1: Add escalate tool to toolsMap**

In `apps/api/src/bootstrap/skill-mode.ts`, update the dynamic import to include `createEscalateTool`:

```typescript
const {
  loadSkill,
  SkillExecutorImpl,
  AnthropicToolCallingAdapter,
  BuilderRegistry,
  createCrmQueryTool,
  createCrmWriteTool,
  createCalendarBookTool,
  createEscalateTool,
  BookingFailureHandler,
} = await import("@switchboard/core/skill-runtime");
```

Also import handoff components:

```typescript
const { HandoffPackageAssembler, HandoffNotifier } = await import("@switchboard/core");
const { PrismaHandoffStore } = await import("@switchboard/db");
```

After the existing store instantiations, add:

```typescript
const handoffStore = new PrismaHandoffStore(prismaClient);
const handoffAssembler = new HandoffPackageAssembler();
```

Then add the escalate tool to the `toolsMap` (after `calendar-book`):

```typescript
    [
      "escalate",
      createEscalateTool({
        assembler: handoffAssembler,
        handoffStore,
        notifier: new HandoffNotifier(/* pass ApprovalNotifier instance — check how it's available in bootstrap */),
        sessionContext: {
          sessionId: "",
          organizationId: "",
          leadSnapshot: { channel: "whatsapp" },
          qualificationSnapshot: { signalsCaptured: {}, qualificationStage: "unknown" },
          messages: [],
        },
      }),
    ],
```

Note: The `sessionContext` must be populated per-execution, not at bootstrap. This requires a factory pattern where the tool is created per skill execution with the actual session context. Check how `SkillMode.execute()` creates the execution context and adjust accordingly — the tool factory should receive the session context at execution time, similar to how `calendarProvider` is resolved.

The practical approach: change `createEscalateTool` to accept a `getSessionContext` function rather than a static object, or create the tool inside the executor per-request. Follow whichever pattern the codebase already uses for per-request state.

- [ ] **Step 2: Update Alex skill frontmatter**

In `skills/alex.md`, add `escalate` to the tools list:

```yaml
tools:
  - crm-query
  - crm-write
  - calendar-book
  - escalate
```

- [ ] **Step 3: Update escalation section in Alex skill**

Replace the `## Escalation` section in `skills/alex.md` with:

```markdown
## Escalation

When escalating:

1. Call `escalate.handoff.create` with the reason and a brief summary of the customer's question
2. Say: "Let me get someone from the team to help with this. They'll reach out shortly."
3. Do NOT continue trying to answer the question after escalating

Escalation triggers:
{{PERSONA_CONFIG.escalationRules}}

- Lead explicitly asks to speak to a human
- Lead expresses frustration or anger
- Question is outside your knowledge scope (fact not in Business Facts)
- Conversation reaches 15 of your messages without a qualification outcome
- Objection is outside the categories above
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/skill-mode.ts skills/alex.md && git commit -m "$(cat <<'EOF'
feat: wire escalate tool into skill-mode bootstrap + Alex skill

Escalation is now operational: Alex calls escalate.handoff.create,
which persists a HandoffPackage and notifies the team via HandoffNotifier.
EOF
)"
```

---

### Task 15: Named Acceptance Test — Missing Knowledge Triggers Escalation

**Files:**

- Create: `packages/core/src/skill-runtime/__tests__/eval-fixtures/15-missing-knowledge-escalation.json`
- Modify: `packages/core/src/skill-runtime/__tests__/eval-suite.test.ts` (if fixture auto-loaded) or create standalone test

- [ ] **Step 1: Create eval fixture**

Create `packages/core/src/skill-runtime/__tests__/eval-fixtures/15-missing-knowledge-escalation.json`:

```json
{
  "name": "missing-knowledge-triggers-escalation",
  "description": "Customer asks about parking (a business fact). Parking notes are NOT in the business facts. Alex must escalate instead of guessing.",
  "messages": [
    {
      "role": "user",
      "content": "Hi, I'd like to book a teeth cleaning. Do you have parking available?"
    }
  ],
  "parameters": {
    "BUSINESS_NAME": "Glow Dental",
    "OPPORTUNITY_ID": "opp_test",
    "LEAD_PROFILE": { "name": "Sarah", "phone": "+6591234567" },
    "PERSONA_CONFIG": {
      "tone": "Professional and warm",
      "qualificationCriteria": {},
      "disqualificationCriteria": {},
      "escalationRules": {},
      "customInstructions": ""
    }
  },
  "context": {
    "BUSINESS_FACTS": "## Business Facts (Operator-Approved — answer ONLY from these facts)\n\n**Business:** Glow Dental\n**Timezone:** Asia/Singapore\n\n### Locations\n- Main: 123 Orchard Rd\n\n### Opening Hours\n- monday: 09:00 - 18:00\n\n### Services\n- Teeth Cleaning: Standard teeth cleaning\n  Duration: 30 min\n  Price: 150 SGD\n\n### Escalation Contact\nDr Tan via whatsapp: +6591234567"
  },
  "expectations": {
    "mustNotContain": ["probably", "I think", "usually", "likely", "most locations", "typically"],
    "mustCallTool": "escalate.handoff.create",
    "toolCallMustContain": { "reason": "missing_knowledge" },
    "responseMustContain": ["team member", "confirm"]
  }
}
```

Note: The `expectations` format should match the eval suite's assertion framework. Check `eval-suite.test.ts` for the exact assertion patterns used and adjust accordingly. The critical assertions are:

1. Alex does NOT guess about parking
2. Alex calls `escalate.handoff.create` with reason `missing_knowledge`
3. Alex says something like "let me get a team member to confirm"

- [ ] **Step 2: Verify the fixture is picked up by the eval suite**

Run: `pnpm --filter @switchboard/core test -- --run -t "missing-knowledge"`
Expected: The test should run (may need LLM API key to actually execute)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/skill-runtime/__tests__/eval-fixtures/15-missing-knowledge-escalation.json && git commit -m "$(cat <<'EOF'
test: add acceptance test for missing knowledge → escalation behavior

Named test: customer asks about parking (not in business facts), Alex
must escalate with missing_knowledge reason instead of improvising.
This is the highest-value trust behavior test.
EOF
)"
```

---

### Task 16: Slice 2 Verification

- [ ] **Step 1: Run all package tests**

```bash
pnpm test -- --run
```

Expected: PASS

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: PASS

- [ ] **Step 4: Verify no references to deleted pipeline-handoff**

```bash
grep -r "pipeline-handoff\|createPipelineHandoffTool" packages/ apps/ skills/ --include="*.ts" --include="*.tsx" --include="*.md" | grep -v "node_modules\|dist\|coverage\|docs/superpowers"
```

Expected: No results (only docs/specs may reference it historically)
