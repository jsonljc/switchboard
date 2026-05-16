# Ad Optimizer Wedge v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire end-to-end attribution from Meta Ads (CTWA + Instant Form) through Contact creation, lifecycle outcomes, and CAPI dispatch — replacing the stubbed CRM provider so the weekly audit produces real outcome-aware recommendations.

**Architecture:** Extend existing WhatsApp message parsers to capture `ctwa_clid`. Build two source adapters that submit `lead.intake` intents through PlatformIngress. Add `sourceType` to Contact + `ctwa_clid` to attribution. Introduce a source-aware `OutcomeDispatcher` that wraps the existing `MetaCAPIDispatcher` with correct `action_source` per source. Replace the stub `CrmDataProvider` with a real implementation reading from Contact + LifecycleRevenueEvent. Extend AuditRunner for per-source funnels and cross-source comparison.

**Tech Stack:** TypeScript (ESM), Prisma, Zod, Vitest, Inngest, Fastify, Next.js (dashboard), pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-04-26-ad-optimizer-wedge-v1-design.md`

**Suggested cut-point:** Tasks 1–7 form the **attribution spine** (Contacts + CAPI flow correctly, audit still uses stub). Tasks 8–14 transition the **audit to real outcomes**. Either could ship as a standalone PR if you want a checkpoint.

---

## File Structure

### New files

- `packages/schemas/src/lead-intake.ts` — `LeadIntake`, `LeadSource` enum
- `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts` (+ `.test.ts`)
- `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts` (+ `.test.ts`)
- `packages/ad-optimizer/src/outcome-dispatcher.ts` (+ `.test.ts`)
- `packages/ad-optimizer/src/crm-data-provider/real-provider.ts` (+ `.test.ts`)
- `packages/ad-optimizer/src/analyzers/source-comparator.ts` (+ `.test.ts`)
- `packages/ad-optimizer/src/onboarding/coverage-validator.ts` (+ `.test.ts`)
- `packages/core/src/intents/lead-intake-handler.ts` (+ `.test.ts`)
- `packages/db/prisma/migrations/<timestamp>_contact_source_type/migration.sql`
- `apps/dashboard/src/components/ad-optimizer/source-comparison-card.tsx` (+ `.test.tsx`)
- `apps/dashboard/src/components/onboarding/attribution-coverage.tsx` (+ `.test.tsx`)

### Modified files

- `apps/chat/src/adapters/whatsapp-parsers.ts` — capture `ctwa_clid`, `ctwa_source_url` in metadata
- `packages/schemas/src/lifecycle.ts` — add `sourceType`, extend `attribution` shape
- `packages/db/prisma/schema.prisma` — add `Contact.sourceType` enum + index
- `packages/ad-optimizer/src/meta-leads-ingester.ts` — add Contact creation hook
- `packages/ad-optimizer/src/meta-capi-dispatcher.ts` — accept explicit `actionSource` override
- `packages/ad-optimizer/src/inngest-functions.ts` — resolve `orgId` TODO, wire `RealCrmDataProvider`
- `packages/ad-optimizer/src/audit-runner.ts` — per-source funnel pass + invoke source comparator
- `packages/ad-optimizer/src/metric-diagnostician.ts` — add outcome-aware diagnosis patterns
- `packages/ad-optimizer/src/recommendation-engine.ts` — add `shift_budget_to_source`, `switch_optimization_event`, `harden_capi_attribution`
- `packages/ad-optimizer/src/index.ts` — export new modules
- `packages/core/src/intent-registry.ts` — register `lead.intake` intent
- `apps/api/src/bootstrap/inngest.ts` — register coverage validator job (if scheduled)
- `apps/dashboard/src/components/ad-optimizer/ad-optimizer-section.tsx` — slot source-comparison-card

---

## Task 1: Add `sourceType` to Contact schema (Prisma + Zod)

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Contact model, lines ~1396–1425)
- Create: `packages/db/prisma/migrations/<timestamp>_contact_source_type/migration.sql`
- Modify: `packages/schemas/src/lifecycle.ts` (Contact schema ~L79-97 + AttributionChain)
- Test: `packages/schemas/src/lifecycle.test.ts` (or new `lifecycle-source-type.test.ts`)

- [ ] **Step 1: Write failing schema test**

Create `packages/schemas/src/lifecycle-source-type.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ContactSchema, LeadSourceTypeSchema } from "./lifecycle.js";

describe("Contact.sourceType", () => {
  it("accepts ctwa, instant_form, organic", () => {
    expect(LeadSourceTypeSchema.parse("ctwa")).toBe("ctwa");
    expect(LeadSourceTypeSchema.parse("instant_form")).toBe("instant_form");
    expect(LeadSourceTypeSchema.parse("organic")).toBe("organic");
  });

  it("rejects unknown source", () => {
    expect(() => LeadSourceTypeSchema.parse("tiktok")).toThrow();
  });

  it("Contact accepts attribution.ctwa_clid and attribution.leadgen_id", () => {
    const c = ContactSchema.parse({
      id: "c1",
      organizationId: "o1",
      primaryChannel: "whatsapp",
      stage: "lead",
      sourceType: "ctwa",
      attribution: { ctwa_clid: "abc123", capturedAt: "2026-04-26T00:00:00Z" },
      roles: [],
      firstContactAt: "2026-04-26T00:00:00Z",
      lastActivityAt: "2026-04-26T00:00:00Z",
    });
    expect(c.sourceType).toBe("ctwa");
    expect(c.attribution?.ctwa_clid).toBe("abc123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test lifecycle-source-type`
Expected: FAIL — `LeadSourceTypeSchema` not exported.

- [ ] **Step 3: Add Zod schema**

In `packages/schemas/src/lifecycle.ts`, add near top of Contact section:

```ts
export const LeadSourceTypeSchema = z.enum(["ctwa", "instant_form", "organic", "web"]);
export type LeadSourceType = z.infer<typeof LeadSourceTypeSchema>;
```

Extend the existing AttributionChain schema (find it in lifecycle.ts) by adding optional fields:

```ts
ctwa_clid: z.string().optional(),
leadgen_id: z.string().optional(),
referralUrl: z.string().optional(),
capturedAt: z.string().datetime().optional(),
```

Extend `ContactSchema` to add:

```ts
sourceType: LeadSourceTypeSchema.optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test lifecycle-source-type`
Expected: PASS.

- [ ] **Step 5: Add Prisma migration**

In `packages/db/prisma/schema.prisma`, modify Contact model:

```prisma
model Contact {
  // ... existing fields ...
  sourceType         String?  // "ctwa" | "instant_form" | "organic" | "web"
  // ... existing fields ...

  @@index([organizationId, sourceType, createdAt])
}
```

Generate migration:

```bash
pnpm --filter @switchboard/db exec prisma migrate dev --name contact_source_type --create-only
```

Verify the generated SQL adds `source_type` column + index, then apply:

```bash
pnpm --filter @switchboard/db exec prisma migrate dev
pnpm db:generate
```

- [ ] **Step 6: Run all schema + db tests**

Run: `pnpm --filter @switchboard/schemas test && pnpm --filter @switchboard/db test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/lifecycle.ts packages/schemas/src/lifecycle-source-type.test.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(schemas): add Contact.sourceType and CTWA/IF attribution fields"
```

---

## Task 2: Define `LeadIntake` shared types

**Files:**

- Create: `packages/schemas/src/lead-intake.ts`
- Create: `packages/schemas/src/lead-intake.test.ts`
- Modify: `packages/schemas/src/index.ts` (add export)

- [ ] **Step 1: Write failing test**

Create `packages/schemas/src/lead-intake.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LeadIntakeSchema } from "./lead-intake.js";

describe("LeadIntakeSchema", () => {
  it("validates a CTWA intake", () => {
    const intake = LeadIntakeSchema.parse({
      source: "ctwa",
      organizationId: "o1",
      deploymentId: "d1",
      contact: { phone: "+6591234567", channel: "whatsapp" },
      attribution: {
        ctwa_clid: "ARxx_abc",
        sourceAdId: "120000000",
        sourceCampaignId: "120000001",
        capturedAt: "2026-04-26T00:00:00Z",
      },
      idempotencyKey: "+6591234567:ARxx_abc",
    });
    expect(intake.source).toBe("ctwa");
  });

  it("validates an Instant Form intake", () => {
    const intake = LeadIntakeSchema.parse({
      source: "instant_form",
      organizationId: "o1",
      deploymentId: "d1",
      contact: { email: "a@b.com" },
      attribution: {
        leadgen_id: "999",
        sourceAdId: "120000000",
        sourceCampaignId: "120000001",
        capturedAt: "2026-04-26T00:00:00Z",
      },
      idempotencyKey: "leadgen:999",
    });
    expect(intake.source).toBe("instant_form");
  });

  it("rejects intake with no contact identifier", () => {
    expect(() =>
      LeadIntakeSchema.parse({
        source: "ctwa",
        organizationId: "o1",
        deploymentId: "d1",
        contact: {},
        attribution: { capturedAt: "2026-04-26T00:00:00Z" },
        idempotencyKey: "x",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/schemas test lead-intake`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement schema**

Create `packages/schemas/src/lead-intake.ts`:

```ts
import { z } from "zod";

export const LeadSourceSchema = z.enum(["ctwa", "instant_form"]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

const ContactIdentifiersSchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    channel: z.enum(["whatsapp", "email", "sms"]).optional(),
    name: z.string().optional(),
  })
  .refine((v) => Boolean(v.phone || v.email), {
    message: "contact must include phone or email",
  });

export const LeadIntakeAttributionSchema = z.object({
  ctwa_clid: z.string().optional(),
  leadgen_id: z.string().optional(),
  referralUrl: z.string().optional(),
  sourceAdId: z.string().optional(),
  sourceAdsetId: z.string().optional(),
  sourceCampaignId: z.string().optional(),
  capturedAt: z.string().datetime(),
  raw: z.record(z.unknown()).optional(),
});

export const LeadIntakeSchema = z.object({
  source: LeadSourceSchema,
  organizationId: z.string(),
  deploymentId: z.string(),
  contact: ContactIdentifiersSchema,
  attribution: LeadIntakeAttributionSchema,
  idempotencyKey: z.string(),
});

export type LeadIntake = z.infer<typeof LeadIntakeSchema>;
```

Add to `packages/schemas/src/index.ts`:

```ts
export * from "./lead-intake.js";
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @switchboard/schemas test lead-intake`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/lead-intake.ts packages/schemas/src/lead-intake.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): add LeadIntake schema for CTWA + Instant Form"
```

---

## Task 3: Capture `ctwa_clid` in WhatsApp parser

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp-parsers.ts` (`extractReferralData`, ~L25-30)
- Test: `apps/chat/src/__tests__/whatsapp.test.ts` (add cases)

- [ ] **Step 1: Write failing test**

Add to `apps/chat/src/__tests__/whatsapp.test.ts`:

```ts
describe("CTWA referral capture", () => {
  it("extracts ctwa_clid from referral", () => {
    const msg = {
      from: "+6591234567",
      type: "text",
      text: { body: "hi" },
      referral: {
        source_id: "120000000",
        source_type: "ad",
        source_url: "https://fb.me/abc",
        ctwa_clid: "ARxx_clickid_abc",
        headline: "Book now",
      },
    };
    const parsed = parseInboundWhatsappMessage(msg);
    expect(parsed.metadata.ctwaClid).toBe("ARxx_clickid_abc");
    expect(parsed.metadata.ctwaSourceUrl).toBe("https://fb.me/abc");
    expect(parsed.metadata.sourceAdId).toBe("120000000");
  });

  it("omits ctwaClid when referral lacks it", () => {
    const msg = { from: "+65...", type: "text", text: { body: "hi" } };
    const parsed = parseInboundWhatsappMessage(msg);
    expect(parsed.metadata.ctwaClid).toBeUndefined();
  });
});
```

(Adapt the import/factory name to whatever the file already exports; check the top of `whatsapp-parsers.ts`.)

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/chat test whatsapp`
Expected: FAIL — `ctwaClid` undefined.

- [ ] **Step 3: Extend `extractReferralData`**

In `apps/chat/src/adapters/whatsapp-parsers.ts`, modify the existing block at lines ~25-30:

```ts
const referral = msg["referral"] as Record<string, unknown> | undefined;
if (referral) {
  if (referral["source_id"]) metadata["sourceAdId"] = referral["source_id"];
  if (referral["source_type"]) metadata["adSourceType"] = referral["source_type"];
  if (referral["source_url"]) metadata["ctwaSourceUrl"] = referral["source_url"];
  if (referral["ctwa_clid"]) metadata["ctwaClid"] = referral["ctwa_clid"];
  if (referral["headline"]) metadata["adHeadline"] = referral["headline"];
  if (referral["body"]) metadata["adBody"] = referral["body"];
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @switchboard/chat test whatsapp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/adapters/whatsapp-parsers.ts apps/chat/src/__tests__/whatsapp.test.ts
git commit -m "feat(chat): capture ctwa_clid and source_url in WhatsApp referral parser"
```

---

## Task 4: Register `lead.intake` intent in core

**Files:**

- Create: `packages/core/src/intents/lead-intake-handler.ts`
- Create: `packages/core/src/intents/lead-intake-handler.test.ts`
- Modify: `packages/core/src/intent-registry.ts` (or wherever intents are registered)

- [ ] **Step 1: Write failing test**

Create `packages/core/src/intents/lead-intake-handler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LeadIntakeHandler } from "./lead-intake-handler.js";

const makeIntake = (overrides = {}) => ({
  source: "ctwa" as const,
  organizationId: "o1",
  deploymentId: "d1",
  contact: { phone: "+6591234567", channel: "whatsapp" as const },
  attribution: {
    ctwa_clid: "abc",
    sourceCampaignId: "c1",
    capturedAt: "2026-04-26T00:00:00Z",
  },
  idempotencyKey: "+6591234567:abc",
  ...overrides,
});

describe("LeadIntakeHandler", () => {
  let store: {
    upsertContact: ReturnType<typeof vi.fn>;
    createActivity: ReturnType<typeof vi.fn>;
    findContactByIdempotency: ReturnType<typeof vi.fn>;
  };
  let handler: LeadIntakeHandler;

  beforeEach(() => {
    store = {
      upsertContact: vi.fn().mockResolvedValue({ id: "contact_1" }),
      createActivity: vi.fn().mockResolvedValue({ id: "act_1" }),
      findContactByIdempotency: vi.fn().mockResolvedValue(null),
    };
    handler = new LeadIntakeHandler({ store });
  });

  it("creates a Contact with sourceType + attribution", async () => {
    await handler.handle(makeIntake());
    expect(store.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "o1",
        sourceType: "ctwa",
        attribution: expect.objectContaining({ ctwa_clid: "abc" }),
      }),
    );
  });

  it("writes lead_received activity", async () => {
    await handler.handle(makeIntake());
    expect(store.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "lead_received", contactId: "contact_1" }),
    );
  });

  it("is idempotent on repeated key", async () => {
    store.findContactByIdempotency.mockResolvedValueOnce({ id: "existing" });
    const result = await handler.handle(makeIntake());
    expect(store.upsertContact).not.toHaveBeenCalled();
    expect(result.contactId).toBe("existing");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/core test lead-intake-handler`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement handler**

Create `packages/core/src/intents/lead-intake-handler.ts`:

```ts
import type { LeadIntake } from "@switchboard/schemas";

export interface LeadIntakeStore {
  findContactByIdempotency(key: string): Promise<{ id: string } | null>;
  upsertContact(input: {
    organizationId: string;
    deploymentId: string;
    phone?: string;
    email?: string;
    channel?: string;
    sourceType: string;
    sourceAdId?: string;
    sourceCampaignId?: string;
    sourceAdsetId?: string;
    attribution: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createActivity(input: {
    contactId: string;
    kind: "lead_received";
    sourceType: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

export interface LeadIntakeHandlerDeps {
  store: LeadIntakeStore;
}

export interface LeadIntakeResult {
  contactId: string;
  duplicate: boolean;
}

export class LeadIntakeHandler {
  constructor(private readonly deps: LeadIntakeHandlerDeps) {}

  async handle(intake: LeadIntake): Promise<LeadIntakeResult> {
    const existing = await this.deps.store.findContactByIdempotency(intake.idempotencyKey);
    if (existing) {
      return { contactId: existing.id, duplicate: true };
    }
    const contact = await this.deps.store.upsertContact({
      organizationId: intake.organizationId,
      deploymentId: intake.deploymentId,
      phone: intake.contact.phone,
      email: intake.contact.email,
      channel: intake.contact.channel,
      sourceType: intake.source,
      sourceAdId: intake.attribution.sourceAdId,
      sourceCampaignId: intake.attribution.sourceCampaignId,
      sourceAdsetId: intake.attribution.sourceAdsetId,
      attribution: intake.attribution,
      idempotencyKey: intake.idempotencyKey,
    });
    await this.deps.store.createActivity({
      contactId: contact.id,
      kind: "lead_received",
      sourceType: intake.source,
      metadata: { attribution: intake.attribution },
    });
    return { contactId: contact.id, duplicate: false };
  }
}
```

- [ ] **Step 4: Register intent**

In `packages/core/src/intent-registry.ts` (find existing intent registrations and follow that pattern), add:

```ts
import { LeadIntakeHandler } from "./intents/lead-intake-handler.js";
// ... existing registrations
intentRegistry.register(
  "lead.intake",
  (deps) => new LeadIntakeHandler({ store: deps.leadIntakeStore }),
);
```

If a `leadIntakeStore` doesn't exist on the registry deps, add it — wire it from `packages/db` in the API bootstrap.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/core test lead-intake-handler`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/intents/ packages/core/src/intent-registry.ts
git commit -m "feat(core): register lead.intake intent handler with idempotency"
```

---

## Task 5: Implement `LeadIntakeStore` against Prisma

**Files:**

- Create: `packages/db/src/stores/lead-intake-store.ts`
- Create: `packages/db/src/stores/lead-intake-store.test.ts`
- Modify: `packages/db/src/index.ts` (export)

- [ ] **Step 1: Write failing integration test (real DB, per project memory)**

Create `packages/db/src/stores/lead-intake-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaLeadIntakeStore } from "./lead-intake-store.js";

const prisma = new PrismaClient();
const store = new PrismaLeadIntakeStore(prisma);

beforeAll(async () => {
  // ensure org + deployment fixtures exist; reuse existing test seed pattern
});

afterEach(async () => {
  await prisma.contact.deleteMany({ where: { idempotencyKey: { startsWith: "test:" } } });
});

describe("PrismaLeadIntakeStore", () => {
  it("creates a Contact with sourceType + attribution JSON", async () => {
    const contact = await store.upsertContact({
      organizationId: "test-org",
      deploymentId: "test-dep",
      phone: "+6591234567",
      channel: "whatsapp",
      sourceType: "ctwa",
      sourceCampaignId: "c1",
      attribution: { ctwa_clid: "abc", capturedAt: "2026-04-26T00:00:00Z" },
      idempotencyKey: "test:ctwa:abc",
    });
    const found = await prisma.contact.findUnique({ where: { id: contact.id } });
    expect(found?.sourceType).toBe("ctwa");
    expect((found?.attribution as { ctwa_clid: string }).ctwa_clid).toBe("abc");
  });

  it("findContactByIdempotency returns existing", async () => {
    const c = await store.upsertContact({
      organizationId: "test-org",
      deploymentId: "test-dep",
      phone: "+6500000000",
      sourceType: "instant_form",
      attribution: { leadgen_id: "9", capturedAt: "2026-04-26T00:00:00Z" },
      idempotencyKey: "test:if:9",
    });
    const found = await store.findContactByIdempotency("test:if:9");
    expect(found?.id).toBe(c.id);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/db test lead-intake-store`
Expected: FAIL.

- [ ] **Step 3: Implement store**

Create `packages/db/src/stores/lead-intake-store.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { LeadIntakeStore } from "@switchboard/core";

export class PrismaLeadIntakeStore implements LeadIntakeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findContactByIdempotency(key: string) {
    const c = await this.prisma.contact.findFirst({
      where: { leadgenId: key }, // reuse existing leadgenId column for idempotency until dedicated column added
      select: { id: true },
    });
    return c ?? null;
  }

  async upsertContact(input: Parameters<LeadIntakeStore["upsertContact"]>[0]) {
    const c = await this.prisma.contact.create({
      data: {
        organizationId: input.organizationId,
        phone: input.phone,
        email: input.email,
        primaryChannel: input.channel ?? "whatsapp",
        firstTouchChannel: input.channel,
        stage: "lead",
        source: input.sourceType,
        sourceType: input.sourceType,
        attribution: input.attribution as object,
        leadgenId: input.idempotencyKey,
        roles: [],
        firstContactAt: new Date(),
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });
    return c;
  }

  async createActivity(input: Parameters<LeadIntakeStore["createActivity"]>[0]) {
    // Use existing ActivityLog model — find the right table name via the Prisma schema
    const a = await this.prisma.activityLog.create({
      data: {
        contactId: input.contactId,
        kind: input.kind,
        metadata: { sourceType: input.sourceType, ...input.metadata },
        occurredAt: new Date(),
      },
      select: { id: true },
    });
    return a;
  }
}
```

(Adapt model + field names to actual Prisma schema; the explorer report noted `ActivityLog`/`ConversationMessage` — confirm the right one for `lead_received` events.)

Export from `packages/db/src/index.ts`.

- [ ] **Step 4: Run test**

Run: `pnpm --filter @switchboard/db test lead-intake-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/stores/lead-intake-store.ts packages/db/src/stores/lead-intake-store.test.ts packages/db/src/index.ts
git commit -m "feat(db): add PrismaLeadIntakeStore for unified lead Contact creation"
```

---

## Task 6: CTWA lead intake adapter

**Files:**

- Create: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`
- Create: `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`
- Create: `packages/ad-optimizer/src/lead-intake/index.ts` (barrel for the subdir)
- Modify: `packages/ad-optimizer/src/index.ts` (export)

- [ ] **Step 1: Write failing test**

Create `packages/ad-optimizer/src/lead-intake/ctwa-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCtwaIntake, CtwaAdapter } from "./ctwa-adapter.js";

const makeMessage = (overrides = {}) => ({
  from: "+6591234567",
  metadata: {
    ctwaClid: "ARxx_abc",
    sourceAdId: "120000000",
    ctwaSourceUrl: "https://fb.me/abc",
  },
  organizationId: "o1",
  deploymentId: "d1",
  ...overrides,
});

describe("buildCtwaIntake", () => {
  it("produces a LeadIntake from a parsed WhatsApp message", () => {
    const intake = buildCtwaIntake(makeMessage(), { now: () => new Date("2026-04-26T00:00:00Z") });
    expect(intake.source).toBe("ctwa");
    expect(intake.contact.phone).toBe("+6591234567");
    expect(intake.attribution.ctwa_clid).toBe("ARxx_abc");
    expect(intake.idempotencyKey).toBe("+6591234567:ARxx_abc");
  });

  it("returns null when message has no ctwa_clid", () => {
    const intake = buildCtwaIntake(makeMessage({ metadata: {} }), { now: () => new Date() });
    expect(intake).toBeNull();
  });
});

describe("CtwaAdapter", () => {
  it("submits via PlatformIngress with lead.intake intent", async () => {
    const submit = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { contactId: "c1", duplicate: false } });
    const adapter = new CtwaAdapter({
      ingress: { submit },
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    await adapter.ingest(makeMessage());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "lead.intake",
        payload: expect.objectContaining({ source: "ctwa" }),
      }),
    );
  });

  it("skips submission for non-CTWA messages", async () => {
    const submit = vi.fn();
    const adapter = new CtwaAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeMessage({ metadata: {} }));
    expect(submit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test ctwa-adapter`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement adapter**

Create `packages/ad-optimizer/src/lead-intake/ctwa-adapter.ts`:

```ts
import type { LeadIntake } from "@switchboard/schemas";

export interface ParsedWhatsappMessage {
  from: string;
  metadata: Record<string, unknown>;
  organizationId: string;
  deploymentId: string;
}

export interface IngressLike {
  submit(req: {
    intent: string;
    payload: unknown;
    idempotencyKey: string;
  }): Promise<{ ok: boolean; result?: unknown }>;
}

export interface CtwaAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
}

export function buildCtwaIntake(
  msg: ParsedWhatsappMessage,
  opts: { now: () => Date },
): LeadIntake | null {
  const ctwaClid = msg.metadata["ctwaClid"];
  if (typeof ctwaClid !== "string" || !ctwaClid) return null;
  const sourceAdId = msg.metadata["sourceAdId"];
  return {
    source: "ctwa",
    organizationId: msg.organizationId,
    deploymentId: msg.deploymentId,
    contact: { phone: msg.from, channel: "whatsapp" },
    attribution: {
      ctwa_clid: ctwaClid,
      referralUrl:
        typeof msg.metadata["ctwaSourceUrl"] === "string"
          ? (msg.metadata["ctwaSourceUrl"] as string)
          : undefined,
      sourceAdId: typeof sourceAdId === "string" ? sourceAdId : undefined,
      capturedAt: opts.now().toISOString(),
      raw: msg.metadata,
    },
    idempotencyKey: `${msg.from}:${ctwaClid}`,
  };
}

export class CtwaAdapter {
  constructor(private readonly deps: CtwaAdapterDeps) {}

  async ingest(msg: ParsedWhatsappMessage): Promise<void> {
    const intake = buildCtwaIntake(msg, { now: this.deps.now });
    if (!intake) return;
    await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
    });
  }
}
```

Create `packages/ad-optimizer/src/lead-intake/index.ts`:

```ts
export * from "./ctwa-adapter.js";
```

Add to `packages/ad-optimizer/src/index.ts`:

```ts
export * from "./lead-intake/index.js";
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @switchboard/ad-optimizer test ctwa-adapter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/lead-intake/ packages/ad-optimizer/src/index.ts
git commit -m "feat(ad-optimizer): add CTWA lead intake adapter"
```

---

## Task 7: Instant Form lead intake adapter

**Files:**

- Create: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts`
- Create: `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`
- Modify: `packages/ad-optimizer/src/lead-intake/index.ts` (export)

- [ ] **Step 1: Write failing test**

Create `packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildInstantFormIntake, InstantFormAdapter } from "./instant-form-adapter.js";

const makeLead = (overrides = {}) => ({
  leadgenId: "999",
  adId: "120000000",
  campaignId: "120000001",
  formId: "form_42",
  organizationId: "o1",
  deploymentId: "d1",
  fieldData: [
    { name: "email", values: ["a@b.com"] },
    { name: "full_name", values: ["Alice"] },
  ],
  ...overrides,
});

describe("buildInstantFormIntake", () => {
  it("produces a LeadIntake with leadgen_id idempotency", () => {
    const intake = buildInstantFormIntake(makeLead(), {
      now: () => new Date("2026-04-26T00:00:00Z"),
    });
    expect(intake.source).toBe("instant_form");
    expect(intake.contact.email).toBe("a@b.com");
    expect(intake.attribution.leadgen_id).toBe("999");
    expect(intake.idempotencyKey).toBe("leadgen:999");
  });
});

describe("InstantFormAdapter", () => {
  it("submits via PlatformIngress", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const adapter = new InstantFormAdapter({ ingress: { submit }, now: () => new Date() });
    await adapter.ingest(makeLead());
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "lead.intake",
        payload: expect.objectContaining({ source: "instant_form" }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test instant-form-adapter`
Expected: FAIL.

- [ ] **Step 3: Implement adapter**

Create `packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts`:

```ts
import type { LeadIntake } from "@switchboard/schemas";
import type { IngressLike } from "./ctwa-adapter.js";

export interface InstantFormLead {
  leadgenId: string;
  adId?: string;
  adsetId?: string;
  campaignId?: string;
  formId?: string;
  organizationId: string;
  deploymentId: string;
  fieldData: Array<{ name: string; values: string[] }>;
}

const fieldValue = (lead: InstantFormLead, name: string): string | undefined =>
  lead.fieldData.find((f) => f.name === name)?.values[0];

export function buildInstantFormIntake(
  lead: InstantFormLead,
  opts: { now: () => Date },
): LeadIntake {
  return {
    source: "instant_form",
    organizationId: lead.organizationId,
    deploymentId: lead.deploymentId,
    contact: {
      email: fieldValue(lead, "email"),
      phone: fieldValue(lead, "phone_number"),
      name: fieldValue(lead, "full_name"),
    },
    attribution: {
      leadgen_id: lead.leadgenId,
      sourceAdId: lead.adId,
      sourceAdsetId: lead.adsetId,
      sourceCampaignId: lead.campaignId,
      capturedAt: opts.now().toISOString(),
      raw: { formId: lead.formId, fieldData: lead.fieldData },
    },
    idempotencyKey: `leadgen:${lead.leadgenId}`,
  };
}

export interface InstantFormAdapterDeps {
  ingress: IngressLike;
  now: () => Date;
}

export class InstantFormAdapter {
  constructor(private readonly deps: InstantFormAdapterDeps) {}

  async ingest(lead: InstantFormLead): Promise<void> {
    const intake = buildInstantFormIntake(lead, { now: this.deps.now });
    await this.deps.ingress.submit({
      intent: "lead.intake",
      payload: intake,
      idempotencyKey: intake.idempotencyKey,
    });
  }
}
```

Add to `packages/ad-optimizer/src/lead-intake/index.ts`:

```ts
export * from "./instant-form-adapter.js";
```

- [ ] **Step 4: Wire into existing meta-leads-ingester consumer**

Find the existing consumer that calls `parseLeadWebhook` (search `apps/api/src/`). After parsing, call `InstantFormAdapter.ingest` for each lead. Verify by reading the existing route — do not re-implement.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/ad-optimizer test instant-form-adapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ad-optimizer/src/lead-intake/instant-form-adapter.ts packages/ad-optimizer/src/lead-intake/instant-form-adapter.test.ts packages/ad-optimizer/src/lead-intake/index.ts apps/api/src/
git commit -m "feat(ad-optimizer): add Instant Form lead intake adapter"
```

---

## Task 8: Wire CTWA adapter into chat WhatsApp inbound flow

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts` (or the gateway that consumes parsed messages)
- Modify: `apps/chat/src/__tests__/whatsapp.test.ts` (integration assertion)

- [ ] **Step 1: Write integration test**

Add to `apps/chat/src/__tests__/whatsapp.test.ts`:

```ts
it("calls CtwaAdapter.ingest for messages with ctwa_clid", async () => {
  const ingest = vi.fn().mockResolvedValue(undefined);
  const ctwaAdapter = { ingest };
  const handler = createWhatsappInboundHandler({ /* existing deps */, ctwaAdapter });
  await handler({
    /* webhook payload with referral.ctwa_clid */
  });
  expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ ctwaClid: expect.any(String) }) }));
});
```

(Adjust factory + payload to match the file's actual API; the explorer report identified `apps/chat/src/adapters/whatsapp.ts` as the entrypoint.)

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/chat test whatsapp`
Expected: FAIL — adapter not wired.

- [ ] **Step 3: Wire CtwaAdapter into the inbound flow**

In `apps/chat/src/adapters/whatsapp.ts`, after the message is parsed, if `metadata.ctwaClid` is present, call `ctwaAdapter.ingest(parsed)` (fire-and-forget with error logging via `console.warn`). The chat gateway should accept a `ctwaAdapter` in its dependency list.

In `apps/chat/src/managed/runtime-registry.ts` (or wherever the dependency is constructed), instantiate:

```ts
import { CtwaAdapter } from "@switchboard/ad-optimizer";
const ctwaAdapter = new CtwaAdapter({ ingress: platformIngress, now: () => new Date() });
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @switchboard/chat test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat/src/
git commit -m "feat(chat): route CTWA-tagged WhatsApp inbound through lead intake adapter"
```

---

## Task 9: Refactor MetaCAPIDispatcher to accept explicit `actionSource`

**Files:**

- Modify: `packages/ad-optimizer/src/meta-capi-dispatcher.ts` (lines ~60-76)
- Modify: `packages/ad-optimizer/src/meta-capi-dispatcher.test.ts`

- [ ] **Step 1: Write failing test**

Add to `meta-capi-dispatcher.test.ts`:

```ts
it("uses explicit actionSource override when provided", async () => {
  const dispatcher = new MetaCAPIDispatcher(/* deps */);
  const result = await dispatcher.dispatch(
    makeEvent({ actionSource: "business_messaging", attribution: { ctwa_clid: "abc" } }),
  );
  expect(result.payloadSent.action_source).toBe("business_messaging");
});

it("falls back to inferred action_source when override absent", async () => {
  const dispatcher = new MetaCAPIDispatcher(/* deps */);
  const result = await dispatcher.dispatch(makeEvent({ attribution: { lead_id: "lead_123" } }));
  expect(result.payloadSent.action_source).toBe("crm");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test meta-capi-dispatcher`
Expected: FAIL.

- [ ] **Step 3: Modify dispatcher**

In `packages/ad-optimizer/src/meta-capi-dispatcher.ts` (and the `ConversionEvent` schema in `packages/schemas/src/crm-outcome.ts` if needed), add an optional `actionSource` field. Replace the existing inference block:

```ts
let actionSource: string;
if (event.actionSource) {
  actionSource = event.actionSource;
} else if (event.attribution?.lead_id) {
  actionSource = "crm";
} else if (event.attribution?.fbclid && event.eventSourceUrl && event.clientUserAgent) {
  actionSource = "website";
} else {
  actionSource = "system_generated";
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/ad-optimizer test meta-capi-dispatcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/meta-capi-dispatcher.ts packages/ad-optimizer/src/meta-capi-dispatcher.test.ts packages/schemas/src/crm-outcome.ts
git commit -m "feat(ad-optimizer): allow explicit action_source override on CAPI dispatch"
```

---

## Task 10: Source-aware OutcomeDispatcher

**Files:**

- Create: `packages/ad-optimizer/src/outcome-dispatcher.ts`
- Create: `packages/ad-optimizer/src/outcome-dispatcher.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/ad-optimizer/src/outcome-dispatcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutcomeDispatcher } from "./outcome-dispatcher.js";

const makeContact = (sourceType: string, attribution: Record<string, unknown>) => ({
  id: "c1",
  organizationId: "o1",
  sourceType,
  attribution,
});

describe("OutcomeDispatcher", () => {
  let capi: { dispatch: ReturnType<typeof vi.fn> };
  let store: { getContact: ReturnType<typeof vi.fn> };
  let dispatcher: OutcomeDispatcher;

  beforeEach(() => {
    capi = { dispatch: vi.fn().mockResolvedValue({ ok: true }) };
    store = { getContact: vi.fn() };
    dispatcher = new OutcomeDispatcher({ capi, store });
  });

  it("CTWA booked → Schedule with action_source=business_messaging + ctwa_clid", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({ contactId: "c1", kind: "booked" });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Schedule",
        actionSource: "business_messaging",
        attribution: expect.objectContaining({ ctwa_clid: "abc" }),
      }),
    );
  });

  it("Instant Form qualified → Lead with action_source=system_generated", async () => {
    store.getContact.mockResolvedValue(makeContact("instant_form", { leadgen_id: "9" }));
    await dispatcher.handle({ contactId: "c1", kind: "qualified" });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Lead",
        actionSource: "system_generated",
      }),
    );
  });

  it("paid event includes value", async () => {
    store.getContact.mockResolvedValue(makeContact("ctwa", { ctwa_clid: "abc" }));
    await dispatcher.handle({ contactId: "c1", kind: "paid", value: 250.5, currency: "SGD" });
    expect(capi.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "Purchase", value: 250.5, currency: "SGD" }),
    );
  });

  it("organic source → no dispatch, warns", async () => {
    store.getContact.mockResolvedValue(makeContact("organic", {}));
    await dispatcher.handle({ contactId: "c1", kind: "booked" });
    expect(capi.dispatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test outcome-dispatcher`
Expected: FAIL.

- [ ] **Step 3: Implement dispatcher**

Create `packages/ad-optimizer/src/outcome-dispatcher.ts`:

```ts
export type OutcomeKind = "qualified" | "booked" | "showed" | "paid";

export interface OutcomeEvent {
  contactId: string;
  kind: OutcomeKind;
  value?: number;
  currency?: string;
}

interface ContactRecord {
  id: string;
  organizationId: string;
  sourceType: string | null;
  attribution: Record<string, unknown> | null;
}

export interface ContactReader {
  getContact(id: string): Promise<ContactRecord | null>;
}

export interface CapiLike {
  dispatch(event: {
    eventName: string;
    actionSource: string;
    attribution: Record<string, unknown>;
    value?: number;
    currency?: string;
  }): Promise<{ ok: boolean }>;
}

const KIND_TO_EVENT: Record<OutcomeKind, string> = {
  qualified: "Lead",
  booked: "Schedule",
  showed: "Schedule",
  paid: "Purchase",
};

const SOURCE_TO_ACTION_SOURCE: Record<string, string> = {
  ctwa: "business_messaging",
  instant_form: "system_generated",
};

export class OutcomeDispatcher {
  constructor(private readonly deps: { capi: CapiLike; store: ContactReader }) {}

  async handle(event: OutcomeEvent): Promise<void> {
    const contact = await this.deps.store.getContact(event.contactId);
    if (!contact || !contact.sourceType) {
      console.warn(
        `OutcomeDispatcher: skipping ${event.kind} for ${event.contactId}: no sourceType`,
      );
      return;
    }
    const actionSource = SOURCE_TO_ACTION_SOURCE[contact.sourceType];
    if (!actionSource) {
      console.warn(
        `OutcomeDispatcher: skipping ${event.kind} for ${event.contactId}: source ${contact.sourceType} not v1`,
      );
      return;
    }
    await this.deps.capi.dispatch({
      eventName: KIND_TO_EVENT[event.kind],
      actionSource,
      attribution: contact.attribution ?? {},
      value: event.value,
      currency: event.currency,
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/ad-optimizer test outcome-dispatcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/outcome-dispatcher.ts packages/ad-optimizer/src/outcome-dispatcher.test.ts
git commit -m "feat(ad-optimizer): add source-aware OutcomeDispatcher"
```

---

## Task 11: Subscribe OutcomeDispatcher to lifecycle events

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts` or wherever conversion bus subscriptions are wired (the explorer noted `wireAdDispatchers`)
- Test: `apps/api/src/bootstrap/__tests__/outcome-wiring.test.ts` (new)

- [ ] **Step 1: Write subscription test**

Create `apps/api/src/bootstrap/__tests__/outcome-wiring.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { subscribeOutcomeDispatcher } from "../outcome-wiring.js";

describe("subscribeOutcomeDispatcher", () => {
  it("forwards lifecycle.booked events to OutcomeDispatcher", async () => {
    const handle = vi.fn();
    const bus = { subscribe: vi.fn() };
    subscribeOutcomeDispatcher({ bus, dispatcher: { handle } });
    expect(bus.subscribe).toHaveBeenCalledWith("lifecycle.booked", expect.any(Function));
    const callback = bus.subscribe.mock.calls[0][1];
    await callback({ contactId: "c1" });
    expect(handle).toHaveBeenCalledWith({ contactId: "c1", kind: "booked" });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/api test outcome-wiring`
Expected: FAIL.

- [ ] **Step 3: Implement subscription**

Create `apps/api/src/bootstrap/outcome-wiring.ts`:

```ts
import type { OutcomeDispatcher, OutcomeEvent } from "@switchboard/ad-optimizer";

interface ConversionBus {
  subscribe(
    event: string,
    handler: (payload: { contactId: string; value?: number; currency?: string }) => Promise<void>,
  ): void;
}

const KIND_MAP: Record<string, OutcomeEvent["kind"]> = {
  "lifecycle.qualified": "qualified",
  "lifecycle.booked": "booked",
  "lifecycle.showed": "showed",
  "lifecycle.paid": "paid",
};

export function subscribeOutcomeDispatcher(deps: {
  bus: ConversionBus;
  dispatcher: { handle(event: OutcomeEvent): Promise<void> };
}): void {
  for (const [event, kind] of Object.entries(KIND_MAP)) {
    deps.bus.subscribe(event, async (payload) => {
      await deps.dispatcher.handle({
        contactId: payload.contactId,
        kind,
        value: payload.value,
        currency: payload.currency,
      });
    });
  }
}
```

In `apps/api/src/bootstrap/inngest.ts` (near the existing `wireAdDispatchers` call), invoke:

```ts
import { OutcomeDispatcher } from "@switchboard/ad-optimizer";
import { subscribeOutcomeDispatcher } from "./outcome-wiring.js";

const outcomeDispatcher = new OutcomeDispatcher({ capi: metaCapiDispatcher, store: contactReader });
subscribeOutcomeDispatcher({ bus: conversionBus, dispatcher: outcomeDispatcher });
```

(`contactReader` is a thin Prisma wrapper exposing `getContact`. Add it in `packages/db/src/stores/contact-reader.ts` if not present; trivial implementation.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/bootstrap/ packages/db/src/stores/
git commit -m "feat(api): wire OutcomeDispatcher to lifecycle event bus"
```

---

## Task 12: RealCrmDataProvider replaces stub + resolve orgId TODO

**Files:**

- Create: `packages/ad-optimizer/src/crm-data-provider/real-provider.ts`
- Create: `packages/ad-optimizer/src/crm-data-provider/real-provider.test.ts`
- Modify: `packages/ad-optimizer/src/inngest-functions.ts` (lines ~60-88)

- [ ] **Step 1: Write failing test**

Create `packages/ad-optimizer/src/crm-data-provider/real-provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { RealCrmDataProvider } from "./real-provider.js";

const makeStore = (
  rows: Array<{
    sourceType: string;
    sourceCampaignId: string;
    stage: string;
    revenue?: number;
    count: number;
  }>,
) => ({
  queryFunnelCounts: vi.fn().mockResolvedValue(rows),
  queryHistoricalMeans: vi
    .fn()
    .mockResolvedValue({ leadToQualified: 0.5, qualifiedToBooked: 0.6, bookedToPaid: 0.7 }),
});

describe("RealCrmDataProvider", () => {
  it("aggregates per-source funnel from raw counts", async () => {
    const store = makeStore([
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "lead", count: 100 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "qualified", count: 30 },
      { sourceType: "ctwa", sourceCampaignId: "c1", stage: "booked", count: 12 },
      { sourceType: "instant_form", sourceCampaignId: "c1", stage: "lead", count: 200 },
      { sourceType: "instant_form", sourceCampaignId: "c1", stage: "qualified", count: 8 },
    ]);
    const provider = new RealCrmDataProvider(store);
    const data = await provider.getFunnelData({
      orgId: "o1",
      accountId: "a1",
      campaignIds: ["c1"],
      startDate: "2026-04-19",
      endDate: "2026-04-26",
    });
    expect(data.bySource.ctwa.received).toBe(100);
    expect(data.bySource.ctwa.qualified).toBe(30);
    expect(data.bySource.ctwa.booked).toBe(12);
    expect(data.bySource.instant_form.received).toBe(200);
  });

  it("returns benchmarks", async () => {
    const provider = new RealCrmDataProvider(makeStore([]));
    const b = await provider.getBenchmarks({ orgId: "o1", accountId: "a1" });
    expect(b.leadToQualified).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test real-provider`
Expected: FAIL.

- [ ] **Step 3: Implement provider**

Create `packages/ad-optimizer/src/crm-data-provider/real-provider.ts`:

```ts
export interface CrmFunnelStore {
  queryFunnelCounts(query: {
    orgId: string;
    campaignIds: string[];
    startDate: string;
    endDate: string;
  }): Promise<
    Array<{
      sourceType: string;
      sourceCampaignId: string;
      stage: string;
      revenue?: number;
      count: number;
    }>
  >;
  queryHistoricalMeans(query: {
    orgId: string;
  }): Promise<{ leadToQualified: number; qualifiedToBooked: number; bookedToPaid: number }>;
}

export interface SourceFunnel {
  received: number;
  qualified: number;
  booked: number;
  showed: number;
  paid: number;
  revenue: number;
}

const EMPTY: SourceFunnel = {
  received: 0,
  qualified: 0,
  booked: 0,
  showed: 0,
  paid: 0,
  revenue: 0,
};

export class RealCrmDataProvider {
  constructor(private readonly store: CrmFunnelStore) {}

  async getFunnelData(query: {
    orgId: string;
    accountId: string;
    campaignIds: string[];
    startDate: string;
    endDate: string;
  }) {
    const rows = await this.store.queryFunnelCounts({
      orgId: query.orgId,
      campaignIds: query.campaignIds,
      startDate: query.startDate,
      endDate: query.endDate,
    });
    const bySource: Record<string, SourceFunnel> = {
      ctwa: { ...EMPTY },
      instant_form: { ...EMPTY },
    };
    for (const row of rows) {
      const bucket = bySource[row.sourceType];
      if (!bucket) continue;
      const stageKey = row.stage === "lead" ? "received" : row.stage;
      if (stageKey in bucket) {
        (bucket as Record<string, number>)[stageKey] += row.count;
        if (row.revenue) bucket.revenue += row.revenue;
      }
    }
    return {
      bySource,
      // Aggregate for backward-compat with existing CrmFunnelData consumers:
      received: bySource.ctwa.received + bySource.instant_form.received,
      qualified: bySource.ctwa.qualified + bySource.instant_form.qualified,
      booked: bySource.ctwa.booked + bySource.instant_form.booked,
      showed: bySource.ctwa.showed + bySource.instant_form.showed,
      paid: bySource.ctwa.paid + bySource.instant_form.paid,
      revenue: bySource.ctwa.revenue + bySource.instant_form.revenue,
    };
  }

  async getBenchmarks(query: { orgId: string; accountId: string }) {
    return this.store.queryHistoricalMeans({ orgId: query.orgId });
  }
}
```

- [ ] **Step 4: Implement Prisma-backed store**

Create `packages/db/src/stores/crm-funnel-store.ts` implementing `CrmFunnelStore`. Use a single SQL query grouped by `(sourceType, sourceCampaignId, stage)` against `Contact` joined to lifecycle stages, scoped by `organizationId` and `createdAt` between dates. Test it against the real DB following the Task 5 pattern.

- [ ] **Step 5: Resolve orgId TODO**

In `packages/ad-optimizer/src/inngest-functions.ts` around line 74:

```ts
const auditConfig = {
  orgId: deployment.orgId, // resolved from deployment record
  accountId: deployment.adAccountId,
  // ... existing fields
};
```

Wire `RealCrmDataProvider` (with the Prisma store) as the `createCrmProvider` factory. Confirm `deployment.orgId` exists on the deployment model (per the original spec — verify via Prisma schema). If absent, add it via migration before this step.

- [ ] **Step 6: Run all ad-optimizer tests**

Run: `pnpm --filter @switchboard/ad-optimizer test && pnpm --filter @switchboard/db test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ad-optimizer/src/crm-data-provider/ packages/db/src/stores/crm-funnel-store.ts packages/ad-optimizer/src/inngest-functions.ts
git commit -m "feat(ad-optimizer): replace stub CRM provider with real Prisma-backed implementation"
```

---

## Task 13: Source comparator analyzer

**Files:**

- Create: `packages/ad-optimizer/src/analyzers/source-comparator.ts`
- Create: `packages/ad-optimizer/src/analyzers/source-comparator.test.ts`
- Modify: `packages/ad-optimizer/src/audit-runner.ts`
- Modify: `packages/schemas/src/audit-report.ts` (add `sourceComparison` block to schema)

- [ ] **Step 1: Write failing test**

Create `packages/ad-optimizer/src/analyzers/source-comparator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compareSources } from "./source-comparator.js";

describe("compareSources", () => {
  it("computes per-source CPL, cost-per-booked, close rate, true ROAS", () => {
    const result = compareSources({
      bySource: {
        ctwa: { received: 100, qualified: 30, booked: 12, showed: 10, paid: 8, revenue: 800 },
        instant_form: { received: 200, qualified: 16, booked: 4, showed: 3, paid: 1, revenue: 80 },
      },
      spendBySource: { ctwa: 410, instant_form: 380 },
    });
    expect(result.rows).toHaveLength(2);
    const ctwa = result.rows.find((r) => r.source === "ctwa")!;
    expect(ctwa.cpl).toBeCloseTo(4.1, 2);
    expect(ctwa.costPerBooked).toBeCloseTo(34.17, 2);
    expect(ctwa.closeRate).toBeCloseTo(0.08, 2);
    expect(ctwa.trueRoas).toBeCloseTo(1.95, 2);
  });

  it("flags zero-spend sources without dividing by zero", () => {
    const result = compareSources({
      bySource: {
        ctwa: { received: 10, qualified: 0, booked: 0, showed: 0, paid: 0, revenue: 0 },
        instant_form: { received: 0, qualified: 0, booked: 0, showed: 0, paid: 0, revenue: 0 },
      },
      spendBySource: { ctwa: 100, instant_form: 0 },
    });
    expect(result.rows.find((r) => r.source === "instant_form")?.cpl).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test source-comparator`
Expected: FAIL.

- [ ] **Step 3: Implement comparator**

Create `packages/ad-optimizer/src/analyzers/source-comparator.ts`:

```ts
import type { SourceFunnel } from "../crm-data-provider/real-provider.js";

export interface SourceComparisonRow {
  source: string;
  cpl: number | null;
  costPerQualified: number | null;
  costPerBooked: number | null;
  closeRate: number | null;
  trueRoas: number | null;
}

export interface SourceComparisonInput {
  bySource: Record<string, SourceFunnel>;
  spendBySource: Record<string, number>;
}

const safeDiv = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function compareSources(input: SourceComparisonInput): { rows: SourceComparisonRow[] } {
  const rows: SourceComparisonRow[] = [];
  for (const [source, funnel] of Object.entries(input.bySource)) {
    const spend = input.spendBySource[source] ?? 0;
    rows.push({
      source,
      cpl: safeDiv(spend, funnel.received),
      costPerQualified: safeDiv(spend, funnel.qualified),
      costPerBooked: safeDiv(spend, funnel.booked),
      closeRate: safeDiv(funnel.paid, funnel.received),
      trueRoas: safeDiv(funnel.revenue, spend),
    });
  }
  return { rows };
}
```

- [ ] **Step 4: Add to AuditReport schema**

In `packages/schemas/src/audit-report.ts` (find the existing AuditReport schema), add:

```ts
sourceComparison: z.object({
  rows: z.array(z.object({
    source: z.string(),
    cpl: z.number().nullable(),
    costPerQualified: z.number().nullable(),
    costPerBooked: z.number().nullable(),
    closeRate: z.number().nullable(),
    trueRoas: z.number().nullable(),
  })),
}).optional(),
```

- [ ] **Step 5: Wire into AuditRunner**

In `packages/ad-optimizer/src/audit-runner.ts`, after the funnel data fetch (~line 185), call `compareSources` and attach to the report:

```ts
const sourceComparison = compareSources({
  bySource: funnelData.bySource,
  spendBySource: computeSpendBySource(insights, funnelData.bySource),
});
report.sourceComparison = sourceComparison;
```

Implement `computeSpendBySource` in the runner: distribute campaign-level spend across sources by lead share when Meta doesn't provide source-level breakdown directly. Document the assumption inline.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @switchboard/ad-optimizer test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ad-optimizer/src/analyzers/source-comparator.ts packages/ad-optimizer/src/analyzers/source-comparator.test.ts packages/ad-optimizer/src/audit-runner.ts packages/schemas/src/audit-report.ts
git commit -m "feat(ad-optimizer): add cross-source comparison analyzer to weekly audit"
```

---

## Task 14: Outcome-aware diagnoses + recommendations

**Files:**

- Modify: `packages/ad-optimizer/src/metric-diagnostician.ts` + test
- Modify: `packages/ad-optimizer/src/recommendation-engine.ts` + test

- [ ] **Step 1: Write failing diagnostician test**

Add to `metric-diagnostician.test.ts`:

```ts
it("flags lead quality degradation when CPL drops but cost-per-booked rises", () => {
  const diagnoses = diagnose({
    metrics: { cpl: { current: 3, previous: 4 }, costPerBooked: { current: 50, previous: 30 } },
    funnel: { received: 100, qualified: 30, booked: 8 },
  });
  expect(diagnoses.find((d) => d.code === "lead_quality_degradation")).toBeDefined();
});

it("flags CTWA drive-by clickers when chats up but reply rate down", () => {
  const diagnoses = diagnose({
    metrics: {
      chatsStarted: { current: 130, previous: 100 },
      replyRate: { current: 0.3, previous: 0.6 },
    },
    funnel: { received: 130, qualified: 5, booked: 1 },
  });
  expect(diagnoses.find((d) => d.code === "ctwa_drive_by_clickers")).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test metric-diagnostician`
Expected: FAIL.

- [ ] **Step 3: Add diagnosis patterns**

In `metric-diagnostician.ts`, add the two patterns. Pattern 1 (lead quality degradation) checks `cpl.current < cpl.previous && costPerBooked.current > costPerBooked.previous * 1.2`. Pattern 2 (CTWA drive-by) checks `chatsStarted.current > chatsStarted.previous * 1.2 && replyRate.current < replyRate.previous * 0.7`. Each emits a diagnosis with `{ code, severity, message, evidence }`.

- [ ] **Step 4: Write failing recommendation test**

Add to `recommendation-engine.test.ts`:

```ts
it("recommends shift_budget_to_source when one source has much better trueRoas", () => {
  const recs = generateRecommendations({
    diagnoses: [],
    sourceComparison: {
      rows: [
        {
          source: "ctwa",
          cpl: 4,
          costPerBooked: 30,
          closeRate: 0.12,
          trueRoas: 3.2,
          costPerQualified: 10,
        },
        {
          source: "instant_form",
          cpl: 2,
          costPerBooked: 50,
          closeRate: 0.03,
          trueRoas: 0.9,
          costPerQualified: 12,
        },
      ],
    },
  });
  const shift = recs.find((r) => r.action === "shift_budget_to_source");
  expect(shift?.params.from).toBe("instant_form");
  expect(shift?.params.to).toBe("ctwa");
});

it("recommends switch_optimization_event for CTWA optimizing on chats", () => {
  const recs = generateRecommendations({
    diagnoses: [{ code: "ctwa_drive_by_clickers", severity: "high" }],
    sourceComparison: { rows: [] },
  });
  expect(recs.some((r) => r.action === "switch_optimization_event")).toBe(true);
});
```

- [ ] **Step 5: Run tests to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test recommendation-engine`
Expected: FAIL.

- [ ] **Step 6: Implement recommendation actions**

In `recommendation-engine.ts`, add three new action types to the schema (`shift_budget_to_source`, `switch_optimization_event`, `harden_capi_attribution`). Add generation rules:

- If two sources differ in `trueRoas` by ≥2x and the higher one has `closeRate ≥ 0.05`, emit `shift_budget_to_source`.
- If a `ctwa_drive_by_clickers` diagnosis is present, emit `switch_optimization_event` with `params: { from: "Lead", to: "Schedule" }`.
- If `harden_capi_attribution` heuristic fires (no CAPI events received in 7 days for a CTWA campaign), emit it.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @switchboard/ad-optimizer test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ad-optimizer/src/metric-diagnostician.ts packages/ad-optimizer/src/metric-diagnostician.test.ts packages/ad-optimizer/src/recommendation-engine.ts packages/ad-optimizer/src/recommendation-engine.test.ts
git commit -m "feat(ad-optimizer): add outcome-aware diagnoses and source-shift recommendations"
```

---

## Task 15: Onboarding coverage validator

**Files:**

- Create: `packages/ad-optimizer/src/onboarding/coverage-validator.ts` (+ `.test.ts`)

- [ ] **Step 1: Write failing test**

Create `coverage-validator.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CoverageValidator } from "./coverage-validator.js";

describe("CoverageValidator", () => {
  it("classifies campaigns by destination type and reports coverage", async () => {
    const adsClient = {
      listCampaigns: vi.fn().mockResolvedValue([
        { id: "c1", destination_type: "WHATSAPP", spend: 200 },
        { id: "c2", destination_type: "ON_AD", spend: 100 }, // Instant Form
        { id: "c3", destination_type: "WEBSITE", spend: 300 },
      ]),
    };
    const intakeStore = {
      hasRecentLead: vi
        .fn()
        .mockImplementation(async (sourceType: string) => sourceType === "ctwa"),
    };
    const validator = new CoverageValidator({ adsClient, intakeStore });
    const result = await validator.validate({ orgId: "o1", accountId: "a1" });

    expect(result.bySource.ctwa.campaigns).toBe(1);
    expect(result.bySource.ctwa.tracking).toBe("verified");
    expect(result.bySource.instant_form.tracking).toBe("no_recent_traffic");
    expect(result.bySource.web.tracking).toBe("v2_pending");
    // 200 + 100 / (200+100+300) = 50% covered (excluding web)
    expect(result.coveragePct).toBeCloseTo(0.5, 2);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/ad-optimizer test coverage-validator`
Expected: FAIL.

- [ ] **Step 3: Implement validator**

Create `coverage-validator.ts`:

```ts
type Tracking = "verified" | "no_recent_traffic" | "v2_pending" | "missing_webhook";

interface Campaign {
  id: string;
  destination_type: string;
  spend: number;
}

const DESTINATION_TO_SOURCE: Record<string, "ctwa" | "instant_form" | "web"> = {
  WHATSAPP: "ctwa",
  ON_AD: "instant_form",
  WEBSITE: "web",
};

export interface CoverageValidatorDeps {
  adsClient: { listCampaigns(query: { orgId: string; accountId: string }): Promise<Campaign[]> };
  intakeStore: { hasRecentLead(sourceType: string, days: number): Promise<boolean> };
}

export class CoverageValidator {
  constructor(private readonly deps: CoverageValidatorDeps) {}

  async validate(query: { orgId: string; accountId: string }) {
    const campaigns = await this.deps.adsClient.listCampaigns(query);
    const bySource: Record<string, { campaigns: number; spend: number; tracking: Tracking }> = {
      ctwa: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
      instant_form: { campaigns: 0, spend: 0, tracking: "missing_webhook" },
      web: { campaigns: 0, spend: 0, tracking: "v2_pending" },
    };
    for (const c of campaigns) {
      const source = DESTINATION_TO_SOURCE[c.destination_type];
      if (!source) continue;
      bySource[source].campaigns += 1;
      bySource[source].spend += c.spend;
    }
    for (const source of ["ctwa", "instant_form"] as const) {
      if (bySource[source].campaigns === 0) continue;
      const recent = await this.deps.intakeStore.hasRecentLead(source, 7);
      bySource[source].tracking = recent ? "verified" : "no_recent_traffic";
    }
    const coveredSpend = bySource.ctwa.spend + bySource.instant_form.spend;
    const totalSpend = coveredSpend + bySource.web.spend;
    return {
      bySource,
      coveragePct: totalSpend > 0 ? coveredSpend / totalSpend : 0,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/ad-optimizer test coverage-validator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ad-optimizer/src/onboarding/
git commit -m "feat(ad-optimizer): add onboarding coverage validator for CTWA+IF tracking"
```

---

## Task 16: Dashboard — source comparison card

**Files:**

- Create: `apps/dashboard/src/components/ad-optimizer/source-comparison-card.tsx` (+ `.test.tsx`)
- Modify: `apps/dashboard/src/components/ad-optimizer/ad-optimizer-section.tsx`

- [ ] **Step 1: Write failing test**

Create `source-comparison-card.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceComparisonCard } from "./source-comparison-card";

describe("SourceComparisonCard", () => {
  it("renders one row per source with formatted metrics", () => {
    render(
      <SourceComparisonCard
        rows={[
          {
            source: "ctwa",
            cpl: 4.1,
            costPerQualified: 13.7,
            costPerBooked: 34.2,
            closeRate: 0.08,
            trueRoas: 1.95,
          },
          {
            source: "instant_form",
            cpl: 1.9,
            costPerQualified: 23.8,
            costPerBooked: 95,
            closeRate: 0.005,
            trueRoas: 0.21,
          },
        ]}
      />,
    );
    expect(screen.getByText("CTWA")).toBeInTheDocument();
    expect(screen.getByText("Instant Form")).toBeInTheDocument();
    expect(screen.getByText("$4.10")).toBeInTheDocument();
    expect(screen.getByText("1.95×")).toBeInTheDocument();
  });

  it("renders em dash for null metrics", () => {
    render(
      <SourceComparisonCard
        rows={[
          {
            source: "instant_form",
            cpl: null,
            costPerQualified: null,
            costPerBooked: null,
            closeRate: null,
            trueRoas: null,
          },
        ]}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/dashboard test source-comparison-card`
Expected: FAIL.

- [ ] **Step 3: Implement component**

Create `source-comparison-card.tsx` following the dashboard's existing card patterns (use `Card`, `Table` from shadcn/ui per memory). Display source label (CTWA / Instant Form), CPL ($X.XX), Cost per Qualified, Cost per Booked, Close Rate (%), True ROAS (Nx). Use `—` for null values. Use `font-display` and `.section-label` class for headings per design system memory.

- [ ] **Step 4: Slot into ad-optimizer-section.tsx**

Between OutputFeed and MetricTrendChart (~line 57), render `<SourceComparisonCard rows={data.latestReport.sourceComparison?.rows ?? []} />` if `sourceComparison` exists.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS.

- [ ] **Step 6: Visual verification**

Start dev server: `pnpm --filter @switchboard/dashboard dev`. Navigate to a deployment with audit data, confirm card renders. (This is verification only — no code change. Note: per CLAUDE.md, "if you can't test the UI, say so explicitly rather than claiming success.")

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/components/ad-optimizer/
git commit -m "feat(dashboard): add cross-source comparison card to ad-optimizer section"
```

---

## Task 17: Dashboard — onboarding attribution coverage

**Files:**

- Create: `apps/dashboard/src/components/onboarding/attribution-coverage.tsx` (+ `.test.tsx`)

- [ ] **Step 1: Write failing test**

Create `attribution-coverage.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttributionCoverage } from "./attribution-coverage";

describe("AttributionCoverage", () => {
  it("shows coverage percentage and per-source state", () => {
    render(
      <AttributionCoverage
        coveragePct={0.65}
        bySource={{
          ctwa: { campaigns: 2, spend: 400, tracking: "verified" },
          instant_form: { campaigns: 1, spend: 100, tracking: "no_recent_traffic" },
          web: { campaigns: 1, spend: 270, tracking: "v2_pending" },
        }}
      />,
    );
    expect(screen.getByText(/65%/)).toBeInTheDocument();
    expect(screen.getByText(/Verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Coming in v2/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/dashboard test attribution-coverage`
Expected: FAIL.

- [ ] **Step 3: Implement component**

Build the component using shadcn/ui patterns: a headline percentage, a per-source list with status pills (`Verified` green, `No recent test traffic` amber, `Coming in v2` muted, `Webhook missing` red).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/onboarding/attribution-coverage.tsx apps/dashboard/src/components/onboarding/attribution-coverage.test.tsx
git commit -m "feat(dashboard): add attribution coverage component for onboarding"
```

---

## Task 18: Pilot validation checklist (no code, gating doc)

**Files:**

- Create: `docs/superpowers/runbooks/2026-04-26-ad-optimizer-wedge-v1-pilot.md`

- [ ] **Step 1: Write the runbook**

Create the file with this content:

```markdown
# Ad Optimizer Wedge v1 — Pilot Validation Runbook

**Pilot account:** Singapore pilot (same as Alex wedge sprint, after Alex passes its 9 criteria)
**Flag:** `attribution_v1_enabled` per deployment

## Pre-flight

- [ ] Meta OAuth connected, account selected
- [ ] WhatsApp Business webhook subscription confirmed in Meta App settings
- [ ] Meta Lead webhook subscription confirmed
- [ ] CAPI access token + Pixel ID set in deployment env

## Day 0 (flag flip)

- [ ] `attribution_v1_enabled = true` for pilot deployment
- [ ] Send a test CTWA click → check `Contact` row created with `sourceType=ctwa` + `attribution.ctwa_clid`
- [ ] Submit a test Instant Form lead → check `Contact` row created with `sourceType=instant_form` + `attribution.leadgen_id`
- [ ] Confirm CAPI Lead event visible in Meta Events Manager for IF lead with `action_source=system_generated`

## Day 1-7 (operating window)

- [ ] At least one CTWA lead booked by Alex → CAPI Schedule event with `action_source=business_messaging` visible in Events Manager
- [ ] At least one IF lead marked qualified by operator → CAPI Lead event visible
- [ ] Coverage validator output produced; ≥80% spend coverage for non-Web campaigns

## Day 7 (first audit)

- [ ] Monday cron runs successfully
- [ ] Audit report shows non-zero per-source funnel data for both CTWA and IF
- [ ] Source comparison card renders in dashboard with differentiated metrics
- [ ] At least one outcome-aware diagnosis or recommendation generated

## Sign-off

- [ ] All boxes checked → declare v1 ready, remove stub provider, document any gotchas
- [ ] Failures → file issues, fix, re-run validation cycle
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/
git commit -m "docs(runbook): add ad-optimizer wedge v1 pilot validation checklist"
```

---

## Self-Review (post-write)

**Spec coverage check:** Walked through spec sections 4.1–4.6 and 7 (error handling). All architecture sections have a corresponding task. Outcome-aware diagnoses (4.5) → Task 14. Onboarding validation (4.6) → Task 15. Pilot rollout (section 9) → Task 18. Source comparator (4.5) → Task 13. Real CRM provider (4.4) → Task 12. Outcome dispatcher (4.3) → Tasks 10–11. CAPI override (4.3) → Task 9. Lead intake spine (4.1) → Tasks 4–8. Schema (4.2) → Tasks 1–2. Edge cases (organic fallback, idempotency) covered in tests in Tasks 4, 6, 10. Coverage looks complete.

**Placeholder scan:** No TBD/TODO in steps. One soft gap — Task 5 step 3 says "find the right table name via the Prisma schema" for ActivityLog. This is acceptable because the explorer report flagged uncertainty (`ActivityLog` vs `ConversationMessage`); the implementer must confirm. Same for Task 7 step 4 ("find the existing consumer that calls parseLeadWebhook"). These are real lookups, not unwritten plan content.

**Type consistency check:** `LeadIntake.attribution.capturedAt` is `z.string().datetime()` everywhere. `LeadSource` enum is `"ctwa" | "instant_form"` in `lead-intake.ts` (Task 2) but `LeadSourceType` in `lifecycle.ts` (Task 1) adds `"organic"` and `"web"` — intentional split: intake never accepts organic/web (organic = no intake event fired; web = v2). Contact.sourceType reads the broader enum because it stores the result. `OutcomeDispatcher` uses `Record<string, string>` keyed map for source → action_source, which is a string lookup — type-safe enough for v1. `compareSources` uses `Record<string, SourceFunnel>` not the enum to allow organic to appear if backfilled. Consistent.
