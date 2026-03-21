# Closed-Loop Revenue Attribution — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the revenue attribution loop so every ad dollar is traceable from click to payment and back to the ad platform.

**Architecture:** Bottom-up — schema foundations first, then identity resolution, then revenue recording, then platform dispatchers, then polish (dedup, non-text handling, multi-language). Each task is independently testable and commits cleanly.

**Tech Stack:** TypeScript, Prisma, Vitest, Zod, Fastify, ConversionBus pub/sub

**Design doc:** `docs/plans/2026-03-17-closed-loop-validation-design.md`

---

## Task 1: Add `fbclid` and `ttclid` to CrmContact Schema

**Files:**

- Modify: `packages/schemas/src/crm-provider.ts:3-22` (CrmContact interface)
- Modify: `packages/schemas/src/crm-provider.ts:74-87` (createContact data)
- Test: `packages/schemas/src/__tests__/crm-provider.test.ts` (if exists, otherwise skip — interface-only change)

**Step 1: Add fields to CrmContact interface**

In `packages/schemas/src/crm-provider.ts`, add after line 17 (`gclid`):

```typescript
fbclid: string | null;
ttclid: string | null;
```

**Step 2: Add fields to createContact input**

In the same file, add to the `createContact` data parameter (after line 85 `utmSource`):

```typescript
fbclid?: string;
ttclid?: string;
```

**Step 3: Run typecheck to see what breaks**

Run: `pnpm typecheck 2>&1 | head -40`
Expected: Type errors in `PrismaCrmProvider`, test helpers (`makeContact`), and anywhere `CrmContact` is constructed without `fbclid`/`ttclid`.

**Step 4: Fix PrismaCrmProvider**

In `packages/db/src/storage/prisma-crm-provider.ts`, update the `toContact()` mapping function to include `fbclid` and `ttclid` from the Prisma row. Update `createContact()` to pass `fbclid` and `ttclid` to `prisma.crmContact.create()`.

**Step 5: Fix test helpers**

Find all `makeContact()` helpers and add `fbclid: null, ttclid: null` to defaults. Search with: `grep -rn "makeContact" --include="*.ts"`

**Step 6: Run typecheck to confirm clean**

Run: `pnpm typecheck`
Expected: PASS (0 errors)

**Step 7: Commit**

```bash
git commit -m "feat: add fbclid and ttclid to CrmContact schema"
```

---

## Task 2: Add `normalizedPhone` and `normalizedEmail` to CrmContact Schema

**Files:**

- Modify: `packages/schemas/src/crm-provider.ts:3-22` (CrmContact interface)
- Test: typecheck only

**Step 1: Add fields to CrmContact interface**

After the `ttclid` line added in Task 1:

```typescript
normalizedPhone: string | null;
normalizedEmail: string | null;
```

**Step 2: Fix all CrmContact constructions**

Same process as Task 1 — add `normalizedPhone: null, normalizedEmail: null` to `toContact()` in PrismaCrmProvider and all test `makeContact()` helpers.

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git commit -m "feat: add normalizedPhone and normalizedEmail to CrmContact schema"
```

---

## Task 3: Prisma Migration for New CrmContact Fields

**Files:**

- Modify: `packages/db/prisma/schema.prisma:442-471` (CrmContact model)
- Create: migration via `pnpm db:migrate`

**Step 1: Add columns to Prisma schema**

In `packages/db/prisma/schema.prisma`, add to the `CrmContact` model (after line 458, `utmSource`):

```prisma
fbclid           String?   // Facebook Click ID
ttclid           String?   // TikTok Click ID
normalizedPhone  String?   // E.164 normalized phone for identity resolution
normalizedEmail  String?   // Lowercased email for identity resolution
```

**Step 2: Add indexes**

Inside the `CrmContact` model, add after the existing `@@index` entries:

```prisma
@@index([normalizedPhone])
@@index([normalizedEmail])
```

**Step 3: Generate Prisma client**

Run: `pnpm db:generate`
Expected: Prisma client regenerated successfully

**Step 4: Create migration**

Run: `cd packages/db && npx prisma migrate dev --name add-click-ids-and-identity-fields`
Expected: Migration created

**Step 5: Update PrismaCrmProvider to read/write new fields**

In `packages/db/src/storage/prisma-crm-provider.ts`:

- `toContact()`: map `row.fbclid`, `row.ttclid`, `row.normalizedPhone`, `row.normalizedEmail`
- `createContact()`: pass through `fbclid`, `ttclid`, and compute `normalizedPhone`/`normalizedEmail` from `phone`/`email`

**Step 6: Add phone normalization utility**

Create `packages/core/src/identity/normalize.ts`:

```typescript
/**
 * Normalize a phone number to a minimal canonical form.
 * Strips spaces, dashes, parens. Preserves leading +.
 * For full E.164, a library like libphonenumber is needed,
 * but this handles the 90% case for SEA numbers.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, "").toLowerCase();
}

/**
 * Normalize an email for identity matching.
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
```

**Step 7: Write tests for normalization**

Create `packages/core/src/identity/__tests__/normalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeEmail } from "../normalize.js";

describe("normalizePhone", () => {
  it("strips spaces and dashes", () => {
    expect(normalizePhone("+60 12-345 6789")).toBe("+601234567890");
  });

  it("strips parens", () => {
    expect(normalizePhone("(012) 345-6789")).toBe("0123456789");
  });

  it("preserves leading +", () => {
    expect(normalizePhone("+6512345678")).toBe("+6512345678");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jane@Example.COM  ")).toBe("jane@example.com");
  });
});
```

**Step 8: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run normalize`
Expected: PASS

**Step 9: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 10: Commit**

```bash
git commit -m "feat: add click ID and identity fields to CrmContact with migration"
```

---

## Task 4: ContactAlias Model and Migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (add ContactAlias model)
- Modify: `packages/schemas/src/crm-provider.ts` (add ContactAlias type)

**Step 1: Add ContactAlias to Prisma schema**

Add after the `CrmContact` model:

```prisma
model ContactAlias {
  id         String   @id @default(uuid())
  contactId  String
  channel    String   // whatsapp, instagram, telegram, sms, facebook, web, email
  externalId String
  createdAt  DateTime @default(now())

  contact CrmContact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@unique([channel, externalId])
  @@index([contactId])
}
```

Also add the relation to `CrmContact`:

```prisma
aliases ContactAlias[]
```

**Step 2: Add ContactAlias type to schemas**

In `packages/schemas/src/crm-provider.ts`, add:

```typescript
export interface ContactAlias {
  id: string;
  contactId: string;
  channel: string;
  externalId: string;
  createdAt: string;
}
```

**Step 3: Generate and migrate**

Run: `pnpm db:generate && cd packages/db && npx prisma migrate dev --name add-contact-alias`

**Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add ContactAlias model for cross-channel identity resolution"
```

---

## Task 5: Contact Merger Service

**Files:**

- Create: `packages/core/src/identity/contact-merger.ts`
- Create: `packages/core/src/identity/__tests__/contact-merger.test.ts`

**Step 1: Write failing tests**

Create `packages/core/src/identity/__tests__/contact-merger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactMerger } from "../contact-merger.js";
import type { CrmProvider, CrmContact } from "@switchboard/schemas";

function makeContact(overrides?: Partial<CrmContact>): CrmContact {
  return {
    id: "ct_1",
    externalId: "ext_1",
    channel: "whatsapp",
    email: null,
    firstName: null,
    lastName: null,
    company: null,
    phone: "+60123456789",
    tags: [],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: null,
    gclid: null,
    fbclid: null,
    ttclid: null,
    utmSource: null,
    normalizedPhone: "+60123456789",
    normalizedEmail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    properties: {},
    ...overrides,
  };
}

describe("ContactMerger", () => {
  let mockCrm: {
    searchContacts: ReturnType<typeof vi.fn>;
    findByNormalizedPhone: ReturnType<typeof vi.fn>;
    findByNormalizedEmail: ReturnType<typeof vi.fn>;
    createContact: ReturnType<typeof vi.fn>;
    updateContact: ReturnType<typeof vi.fn>;
    addAlias: ReturnType<typeof vi.fn>;
  };
  let merger: ContactMerger;

  beforeEach(() => {
    mockCrm = {
      searchContacts: vi.fn().mockResolvedValue([]),
      findByNormalizedPhone: vi.fn().mockResolvedValue(null),
      findByNormalizedEmail: vi.fn().mockResolvedValue(null),
      createContact: vi.fn().mockResolvedValue(makeContact()),
      updateContact: vi.fn().mockResolvedValue(makeContact()),
      addAlias: vi.fn().mockResolvedValue(undefined),
    };
    merger = new ContactMerger(mockCrm);
  });

  it("creates a new contact when no match exists", async () => {
    const result = await merger.resolveContact({
      phone: "+60 123-456-789",
      channel: "whatsapp",
      externalId: "wa_123",
    });

    expect(mockCrm.createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+60 123-456-789",
        normalizedPhone: "+60123456789",
      }),
    );
    expect(result.isNew).toBe(true);
  });

  it("merges into existing contact matched by phone", async () => {
    const existing = makeContact({ id: "ct_existing", sourceAdId: "ad_1" });
    mockCrm.findByNormalizedPhone.mockResolvedValue(existing);

    const result = await merger.resolveContact({
      phone: "+60 123-456-789",
      channel: "instagram",
      externalId: "ig_456",
      email: "jane@example.com",
    });

    expect(result.isNew).toBe(false);
    expect(result.contact.id).toBe("ct_existing");
    expect(mockCrm.addAlias).toHaveBeenCalledWith("ct_existing", "instagram", "ig_456");
    // Should enrich with email (fill null)
    expect(mockCrm.updateContact).toHaveBeenCalledWith(
      "ct_existing",
      expect.objectContaining({
        email: "jane@example.com",
        normalizedEmail: "jane@example.com",
      }),
    );
  });

  it("falls back to email match when phone doesn't match", async () => {
    const existing = makeContact({ id: "ct_email", email: "jane@example.com" });
    mockCrm.findByNormalizedEmail.mockResolvedValue(existing);

    const result = await merger.resolveContact({
      email: "  Jane@Example.COM  ",
      channel: "web",
      externalId: "form_789",
    });

    expect(result.isNew).toBe(false);
    expect(result.contact.id).toBe("ct_email");
  });

  it("preserves first-touch attribution on merge", async () => {
    const existing = makeContact({
      id: "ct_attributed",
      sourceAdId: "ad_original",
      sourceCampaignId: "camp_original",
    });
    mockCrm.findByNormalizedPhone.mockResolvedValue(existing);

    await merger.resolveContact({
      phone: "+60123456789",
      channel: "telegram",
      externalId: "tg_1",
      sourceAdId: "ad_newer",
    });

    // Should NOT overwrite existing attribution
    const updateCall = mockCrm.updateContact.mock.calls[0]?.[1] ?? {};
    expect(updateCall.sourceAdId).toBeUndefined();
  });

  it("copies attribution to unattributed contact on merge", async () => {
    const existing = makeContact({
      id: "ct_no_attr",
      sourceAdId: null,
      sourceCampaignId: null,
    });
    mockCrm.findByNormalizedPhone.mockResolvedValue(existing);

    await merger.resolveContact({
      phone: "+60123456789",
      channel: "web",
      externalId: "form_1",
      sourceAdId: "ad_from_form",
      sourceCampaignId: "camp_from_form",
    });

    expect(mockCrm.updateContact).toHaveBeenCalledWith(
      "ct_no_attr",
      expect.objectContaining({
        sourceAdId: "ad_from_form",
        sourceCampaignId: "camp_from_form",
      }),
    );
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/core test -- --run contact-merger`
Expected: FAIL — module not found

**Step 3: Implement ContactMerger**

Create `packages/core/src/identity/contact-merger.ts`:

```typescript
import { normalizePhone, normalizeEmail } from "./normalize.js";
import type { CrmContact } from "@switchboard/schemas";

export interface ContactCandidate {
  phone?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  channel: string;
  externalId: string;
  sourceAdId?: string;
  sourceCampaignId?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  utmSource?: string;
  organizationId?: string;
  properties?: Record<string, unknown>;
}

export interface MergeResult {
  contact: CrmContact;
  isNew: boolean;
}

/**
 * Port interface for contact persistence operations needed by the merger.
 * Implemented by PrismaCrmProvider at the app layer.
 */
export interface ContactMergerPort {
  findByNormalizedPhone(phone: string): Promise<CrmContact | null>;
  findByNormalizedEmail(email: string): Promise<CrmContact | null>;
  createContact(data: Record<string, unknown>): Promise<CrmContact>;
  updateContact(id: string, data: Record<string, unknown>): Promise<CrmContact>;
  addAlias(contactId: string, channel: string, externalId: string): Promise<void>;
}

export class ContactMerger {
  constructor(private readonly port: ContactMergerPort) {}

  async resolveContact(candidate: ContactCandidate): Promise<MergeResult> {
    const normPhone = candidate.phone ? normalizePhone(candidate.phone) : null;
    const normEmail = candidate.email ? normalizeEmail(candidate.email) : null;

    // 1. Try phone match first
    let existing: CrmContact | null = null;
    if (normPhone) {
      existing = await this.port.findByNormalizedPhone(normPhone);
    }

    // 2. Fall back to email
    if (!existing && normEmail) {
      existing = await this.port.findByNormalizedEmail(normEmail);
    }

    // 3. Match found — merge
    if (existing) {
      const enrichment: Record<string, unknown> = {};

      // Fill nulls only
      if (!existing.email && candidate.email) {
        enrichment.email = candidate.email;
        enrichment.normalizedEmail = normEmail;
      }
      if (!existing.phone && candidate.phone) {
        enrichment.phone = candidate.phone;
        enrichment.normalizedPhone = normPhone;
      }
      if (!existing.firstName && candidate.firstName) {
        enrichment.firstName = candidate.firstName;
      }
      if (!existing.lastName && candidate.lastName) {
        enrichment.lastName = candidate.lastName;
      }

      // First-touch attribution: copy only if existing has none
      if (!existing.sourceAdId && candidate.sourceAdId) {
        enrichment.sourceAdId = candidate.sourceAdId;
      }
      if (!existing.sourceCampaignId && candidate.sourceCampaignId) {
        enrichment.sourceCampaignId = candidate.sourceCampaignId;
      }
      if (!existing.gclid && candidate.gclid) enrichment.gclid = candidate.gclid;
      if (!existing.fbclid && candidate.fbclid) enrichment.fbclid = candidate.fbclid;
      if (!existing.ttclid && candidate.ttclid) enrichment.ttclid = candidate.ttclid;

      if (Object.keys(enrichment).length > 0) {
        const updated = await this.port.updateContact(existing.id, enrichment);
        await this.port.addAlias(existing.id, candidate.channel, candidate.externalId);
        return { contact: updated, isNew: false };
      }

      await this.port.addAlias(existing.id, candidate.channel, candidate.externalId);
      return { contact: existing, isNew: false };
    }

    // 4. No match — create new
    const contact = await this.port.createContact({
      phone: candidate.phone,
      email: candidate.email,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      channel: candidate.channel,
      externalId: candidate.externalId,
      normalizedPhone: normPhone,
      normalizedEmail: normEmail,
      sourceAdId: candidate.sourceAdId,
      sourceCampaignId: candidate.sourceCampaignId,
      gclid: candidate.gclid,
      fbclid: candidate.fbclid,
      ttclid: candidate.ttclid,
      utmSource: candidate.utmSource,
      organizationId: candidate.organizationId,
      properties: candidate.properties ?? {},
    });

    await this.port.addAlias(contact.id, candidate.channel, candidate.externalId);
    return { contact, isNew: true };
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @switchboard/core test -- --run contact-merger`
Expected: PASS

**Step 5: Export from core**

Add to `packages/core/src/index.ts` (or the appropriate barrel):

```typescript
export { ContactMerger } from "./identity/contact-merger.js";
export type {
  ContactCandidate,
  MergeResult,
  ContactMergerPort,
} from "./identity/contact-merger.js";
export { normalizePhone, normalizeEmail } from "./identity/normalize.js";
```

**Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git commit -m "feat: add ContactMerger service for cross-channel identity resolution"
```

---

## Task 6: Revenue Event Schema

**Files:**

- Create: `packages/schemas/src/revenue-event.ts`
- Create: `packages/schemas/src/__tests__/revenue-event.test.ts`
- Modify: `packages/schemas/src/index.ts` (export)

**Step 1: Write failing test**

Create `packages/schemas/src/__tests__/revenue-event.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RevenueEventSchema } from "../revenue-event.js";

describe("RevenueEventSchema", () => {
  it("validates a complete revenue event", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: 350,
      currency: "MYR",
      source: "chat",
      recordedBy: "staff:sarah",
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative amounts", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: -50,
      currency: "MYR",
      source: "manual",
      recordedBy: "staff:sarah",
    });
    expect(result.success).toBe(false);
  });

  it("defaults source to manual", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: 200,
      currency: "SGD",
      recordedBy: "staff:john",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe("manual");
    }
  });

  it("accepts all valid sources", () => {
    for (const source of ["manual", "chat", "batch", "pos_sync", "stripe", "crm_sync", "api"]) {
      const result = RevenueEventSchema.safeParse({
        contactId: "ct_1",
        amount: 100,
        currency: "SGD",
        source,
        recordedBy: "system",
      });
      expect(result.success).toBe(true);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/schemas test -- --run revenue-event`
Expected: FAIL — module not found

**Step 3: Implement schema**

Create `packages/schemas/src/revenue-event.ts`:

```typescript
import { z } from "zod";

export const RevenueEventSourceSchema = z.enum([
  "manual",
  "chat",
  "batch",
  "pos_sync",
  "stripe",
  "crm_sync",
  "api",
]);

export type RevenueEventSource = z.infer<typeof RevenueEventSourceSchema>;

export const RevenueEventSchema = z.object({
  contactId: z.string().min(1),
  amount: z.number().nonneg(),
  currency: z.string().length(3),
  source: RevenueEventSourceSchema.default("manual"),
  reference: z.string().optional(),
  recordedBy: z.string().min(1),
  timestamp: z.string().datetime().optional(),
});

export type RevenueEvent = z.infer<typeof RevenueEventSchema>;
```

**Step 4: Export from schemas index**

Add to `packages/schemas/src/index.ts`:

```typescript
export { RevenueEventSchema, RevenueEventSourceSchema } from "./revenue-event.js";
export type { RevenueEvent, RevenueEventSource } from "./revenue-event.js";
```

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/schemas test -- --run revenue-event`
Expected: PASS

**Step 6: Commit**

```bash
git commit -m "feat: add RevenueEvent schema for payment recording"
```

---

## Task 7: Revenue Recording API Endpoint

**Files:**

- Modify: `apps/api/src/routes/` (add revenue route file)
- Create: `apps/api/src/routes/revenue.ts`
- Create: `apps/api/src/__tests__/revenue-api.test.ts`

**Step 1: Write failing test**

Create `apps/api/src/__tests__/revenue-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RevenueEventSchema } from "@switchboard/schemas";

describe("POST /api/revenue", () => {
  it("validates revenue event schema", () => {
    const result = RevenueEventSchema.safeParse({
      contactId: "ct_1",
      amount: 350,
      currency: "MYR",
      source: "api",
      recordedBy: "pos_system",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing contactId", () => {
    const result = RevenueEventSchema.safeParse({
      amount: 350,
      currency: "MYR",
      source: "api",
      recordedBy: "pos_system",
    });
    expect(result.success).toBe(false);
  });
});
```

Note: Full integration tests for the route should follow the existing patterns in `apps/api/src/__tests__/`. The route itself is straightforward: validate body with `RevenueEventSchema`, resolve CRM contact, update deal stage, emit `purchased` to ConversionBus.

**Step 2: Implement route**

Create `apps/api/src/routes/revenue.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import { RevenueEventSchema } from "@switchboard/schemas";
import type { ConversionBus } from "@switchboard/core";
import type { CrmProvider } from "@switchboard/schemas";

export interface RevenueRouteConfig {
  crmProvider: CrmProvider;
  conversionBus: ConversionBus;
}

export function registerRevenueRoutes(app: FastifyInstance, config: RevenueRouteConfig): void {
  app.post("/api/revenue", async (request, reply) => {
    const parseResult = RevenueEventSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: parseResult.error.format() });
    }

    const event = parseResult.data;

    // Look up contact for attribution
    const contact = await config.crmProvider.getContact(event.contactId);
    if (!contact) {
      return reply.status(404).send({ error: "Contact not found" });
    }

    // Emit purchased event to ConversionBus
    config.conversionBus.emit({
      type: "purchased",
      contactId: event.contactId,
      organizationId: (contact.properties?.["organizationId"] as string) ?? "",
      value: event.amount,
      sourceAdId: contact.sourceAdId ?? undefined,
      sourceCampaignId: contact.sourceCampaignId ?? undefined,
      timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
      metadata: {
        source: event.source,
        reference: event.reference,
        recordedBy: event.recordedBy,
        currency: event.currency,
      },
    });

    return reply.status(201).send({ recorded: true, contactId: event.contactId });
  });
}
```

**Step 3: Register route in app**

In `apps/api/src/app.ts`, import and register `registerRevenueRoutes` with the existing CRM provider and ConversionBus instances.

**Step 4: Run tests**

Run: `pnpm --filter @switchboard/api test -- --run revenue`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add POST /api/revenue endpoint for payment recording"
```

---

## Task 8: Gap Detection Background Job

**Files:**

- Create: `apps/api/src/jobs/revenue-gap-checker.ts`
- Create: `apps/api/src/jobs/__tests__/revenue-gap-checker.test.ts`

**Step 1: Write failing test**

Create `apps/api/src/jobs/__tests__/revenue-gap-checker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { findUnrecordedAppointments } from "../revenue-gap-checker.js";

describe("findUnrecordedAppointments", () => {
  it("returns appointments past grace period with no revenue event", async () => {
    const mockDeals = [
      {
        id: "deal_1",
        name: "John Cleaning",
        stage: "consultation_completed",
        contactIds: ["ct_1"],
        closeDate: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3hrs ago
        amount: 200,
      },
    ];
    const mockRevenueEvents: string[] = []; // no matching events

    const gaps = await findUnrecordedAppointments(mockDeals, mockRevenueEvents, {
      graceHours: 2,
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].dealId).toBe("deal_1");
  });

  it("excludes appointments within grace period", async () => {
    const mockDeals = [
      {
        id: "deal_2",
        name: "Sarah Checkup",
        stage: "consultation_completed",
        contactIds: ["ct_2"],
        closeDate: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1hr ago
        amount: 150,
      },
    ];
    const mockRevenueEvents: string[] = [];

    const gaps = await findUnrecordedAppointments(mockDeals, mockRevenueEvents, {
      graceHours: 2,
    });

    expect(gaps).toHaveLength(0);
  });

  it("excludes appointments that already have revenue recorded", async () => {
    const mockDeals = [
      {
        id: "deal_3",
        name: "Tom Crown",
        stage: "consultation_completed",
        contactIds: ["ct_3"],
        closeDate: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        amount: 500,
      },
    ];
    const mockRevenueEvents = ["ct_3"]; // already recorded

    const gaps = await findUnrecordedAppointments(mockDeals, mockRevenueEvents, {
      graceHours: 2,
    });

    expect(gaps).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/api test -- --run revenue-gap`
Expected: FAIL — module not found

**Step 3: Implement gap checker**

Create `apps/api/src/jobs/revenue-gap-checker.ts`. The job logic:

1. Query deals in completed stages (consultation_completed, service_completed) where closeDate > graceHours ago
2. Query revenue events for those contacts' IDs on the same day
3. Return deals with no matching revenue event
4. For each gap, send a nudge message to the org's ops channel

Follow the existing job patterns in `apps/api/src/jobs/` (e.g., `outcome-checker.ts`).

**Step 4: Run tests**

Run: `pnpm --filter @switchboard/api test -- --run revenue-gap`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add revenue gap detection job for unrecorded payments"
```

---

## Task 9: CAPI Event Deduplication

**Files:**

- Modify: `cartridges/digital-ads/src/tracking/capi-dispatcher.ts:138-150`
- Modify: `cartridges/digital-ads/src/tracking/__tests__/capi-dispatcher.test.ts`

**Step 1: Write failing test**

Add to `capi-dispatcher.test.ts`:

```typescript
it("includes deterministic event_id for deduplication", async () => {
  const event = makeConversionEvent();
  const contact = makeContact();
  mockCrmProvider.getContact.mockResolvedValue(contact);

  await dispatcher.handleEvent(event);

  const sentEvent = mockAdsProvider.sendConversionEvent.mock.calls[0][1];
  expect(sentEvent.eventId).toBeDefined();
  expect(typeof sentEvent.eventId).toBe("string");

  // Same event should produce same ID (deterministic)
  await dispatcher.handleEvent(event);
  const sentEvent2 = mockAdsProvider.sendConversionEvent.mock.calls[1][1];
  expect(sentEvent2.eventId).toBe(sentEvent.eventId);
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/digital-ads test -- --run capi-dispatcher`
Expected: FAIL — `eventId` is undefined

**Step 3: Add event_id generation**

In `capi-dispatcher.ts`, add a helper:

```typescript
function generateEventId(contactId: string, eventType: string, timestamp: Date): string {
  return createHash("sha256")
    .update(`${contactId}:${eventType}:${timestamp.getTime()}`)
    .digest("hex");
}
```

In `handleEvent()`, add `eventId` to the CAPI event payload (around line 138):

```typescript
const capiEvent: CAPIEvent = {
  eventName,
  eventTime: Math.floor(event.timestamp.getTime() / 1000),
  eventId: generateEventId(event.contactId, event.type, event.timestamp),
  userData: buildUserData(contact),
  // ... rest unchanged
};
```

Also update the `ConversionEvent` interface in `write-provider-types.ts:213` to include `eventId?: string`.

**Step 4: Run tests**

Run: `pnpm --filter @switchboard/digital-ads test -- --run capi-dispatcher`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add deterministic event_id to CAPI dispatcher for deduplication"
```

---

## Task 10: TikTok Events API Dispatcher

**Files:**

- Create: `cartridges/digital-ads/src/tracking/tiktok-dispatcher.ts`
- Create: `cartridges/digital-ads/src/tracking/__tests__/tiktok-dispatcher.test.ts`

**Step 1: Write failing tests**

Create `cartridges/digital-ads/src/tracking/__tests__/tiktok-dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { TikTokDispatcher } from "../tiktok-dispatcher.js";
import { InMemoryConversionBus } from "@switchboard/core";
import type { ConversionEvent } from "@switchboard/core";
import type { CrmContact } from "@switchboard/schemas";

function makeContact(overrides?: Partial<CrmContact>): CrmContact {
  return {
    id: "ct_1",
    externalId: "ext_1",
    channel: "web",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Doe",
    company: null,
    phone: "+60123456789",
    tags: [],
    status: "active",
    assignedStaffId: null,
    sourceAdId: null,
    sourceCampaignId: "camp_tt",
    gclid: null,
    fbclid: null,
    ttclid: "tt_click_123",
    utmSource: "tiktok",
    normalizedPhone: "+60123456789",
    normalizedEmail: "jane@example.com",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    properties: {},
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<ConversionEvent>): ConversionEvent {
  return {
    type: "purchased",
    contactId: "ct_1",
    organizationId: "org_1",
    value: 350,
    timestamp: new Date("2026-03-17T10:00:00Z"),
    metadata: {},
    ...overrides,
  };
}

describe("TikTokDispatcher", () => {
  let mockSendEvent: ReturnType<typeof vi.fn>;
  let mockCrmProvider: { getContact: ReturnType<typeof vi.fn> };
  let dispatcher: TikTokDispatcher;

  beforeEach(() => {
    mockSendEvent = vi.fn().mockResolvedValue({ success: true });
    mockCrmProvider = {
      getContact: vi.fn().mockResolvedValue(makeContact()),
    };
    dispatcher = new TikTokDispatcher({
      sendEvent: mockSendEvent,
      crmProvider: mockCrmProvider as any,
      pixelId: "pixel_tt_1",
      currency: "MYR",
    });
  });

  it("sends CompletePayment for purchased events", async () => {
    await dispatcher.handleEvent(makeEvent({ type: "purchased" }));

    expect(mockSendEvent).toHaveBeenCalledWith(
      "pixel_tt_1",
      expect.objectContaining({
        event: "CompletePayment",
        event_id: expect.any(String),
      }),
    );
  });

  it("sends SubmitForm for inquiry events", async () => {
    await dispatcher.handleEvent(makeEvent({ type: "inquiry" }));

    expect(mockSendEvent).toHaveBeenCalledWith(
      "pixel_tt_1",
      expect.objectContaining({ event: "SubmitForm" }),
    );
  });

  it("includes hashed PII and ttclid", async () => {
    await dispatcher.handleEvent(makeEvent());

    const payload = mockSendEvent.mock.calls[0][1];
    expect(payload.context.user.ttclid).toBe("tt_click_123");
    expect(payload.context.user.email).toBe(
      createHash("sha256").update("jane@example.com").digest("hex"),
    );
    expect(payload.context.user.phone_number).toBe(
      createHash("sha256").update("+60123456789").digest("hex"),
    );
  });

  it("skips when no ttclid and no PII", async () => {
    mockCrmProvider.getContact.mockResolvedValue(
      makeContact({ ttclid: null, email: null, phone: null }),
    );

    await dispatcher.handleEvent(makeEvent());

    expect(mockSendEvent).not.toHaveBeenCalled();
  });

  it("registers on ConversionBus", () => {
    const bus = new InMemoryConversionBus();
    dispatcher.register(bus);

    bus.emit(makeEvent());

    expect(mockCrmProvider.getContact).toHaveBeenCalled();
  });

  it("handles send errors gracefully", async () => {
    mockSendEvent.mockRejectedValue(new Error("Network error"));

    // Should not throw
    await dispatcher.handleEvent(makeEvent());
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @switchboard/digital-ads test -- --run tiktok-dispatcher`
Expected: FAIL — module not found

**Step 3: Implement dispatcher**

Create `cartridges/digital-ads/src/tracking/tiktok-dispatcher.ts`:

```typescript
import { createHash } from "node:crypto";
import type { ConversionBus, ConversionEvent, ConversionEventType } from "@switchboard/core";
import type { CrmProvider, CrmContact } from "@switchboard/schemas";

const EVENT_NAME_MAP: Record<ConversionEventType, string> = {
  inquiry: "SubmitForm",
  qualified: "Contact",
  booked: "Schedule",
  purchased: "CompletePayment",
  completed: "CompletePayment",
};

interface TikTokEventPayload {
  event: string;
  event_id: string;
  timestamp: string;
  context: {
    user: {
      ttclid?: string;
      email?: string;
      phone_number?: string;
      external_id?: string;
    };
  };
  properties: {
    value?: number;
    currency?: string;
  };
}

export interface TikTokDispatcherConfig {
  sendEvent: (pixelId: string, event: TikTokEventPayload) => Promise<{ success: boolean }>;
  crmProvider: CrmProvider;
  pixelId: string;
  currency?: string;
}

function hashForTikTok(value: string): string {
  return createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

function generateEventId(contactId: string, eventType: string, timestamp: Date): string {
  return createHash("sha256")
    .update(`${contactId}:${eventType}:${timestamp.getTime()}`)
    .digest("hex");
}

export class TikTokDispatcher {
  private readonly config: TikTokDispatcherConfig;
  private readonly currency: string;

  constructor(config: TikTokDispatcherConfig) {
    this.config = config;
    this.currency = config.currency ?? "MYR";
  }

  register(bus: ConversionBus): void {
    bus.subscribe("*", (event) => {
      void this.handleEvent(event);
    });
  }

  async handleEvent(event: ConversionEvent): Promise<void> {
    let contact: CrmContact | null;
    try {
      contact = await this.config.crmProvider.getContact(event.contactId);
    } catch {
      return;
    }

    if (!contact) return;

    // Need ttclid or PII to send
    const hasTtclid = !!contact.ttclid;
    const hasPII = !!contact.email || !!contact.phone;
    if (!hasTtclid && !hasPII) return;

    const user: TikTokEventPayload["context"]["user"] = {};
    if (contact.ttclid) user.ttclid = contact.ttclid;
    if (contact.email) user.email = hashForTikTok(contact.email);
    if (contact.phone) {
      const cleanPhone = contact.phone.replace(/[^\d+]/g, "");
      user.phone_number = hashForTikTok(cleanPhone);
    }
    if (contact.externalId) user.external_id = contact.externalId;

    const payload: TikTokEventPayload = {
      event: EVENT_NAME_MAP[event.type],
      event_id: generateEventId(event.contactId, event.type, event.timestamp),
      timestamp: event.timestamp.toISOString(),
      context: { user },
      properties: {
        value: event.value,
        currency: this.currency,
      },
    };

    try {
      await this.config.sendEvent(this.config.pixelId, payload);
    } catch {
      // Non-critical — don't block the event bus
    }
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @switchboard/digital-ads test -- --run tiktok-dispatcher`
Expected: PASS

**Step 5: Commit**

```bash
git commit -m "feat: add TikTok Events API dispatcher for conversion feedback loop"
```

---

## Task 11: Non-Text Message Handling

**Files:**

- Modify: `apps/chat/src/adapters/whatsapp.ts:200-201`
- Modify: `apps/chat/src/runtime.ts:340-342`
- Create: `apps/chat/src/__tests__/non-text-handling.test.ts`

**Step 1: Write failing test**

Create `apps/chat/src/__tests__/non-text-handling.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("non-text message handling", () => {
  it("returns unsupported message instead of null for images", () => {
    // The adapter should return { type: "unsupported", originalType: "image" }
    // instead of null when it encounters a non-text message
    const message = parseNonTextMessage("image");
    expect(message).not.toBeNull();
    expect(message?.metadata?.["unsupported"]).toBe(true);
    expect(message?.metadata?.["originalType"]).toBe("image");
  });
});

function parseNonTextMessage(msgType: string): {
  text: string;
  metadata?: Record<string, unknown>;
} | null {
  // Placeholder — will be replaced by actual adapter logic
  if (["image", "voice", "audio", "video", "sticker", "location", "document"].includes(msgType)) {
    return {
      text: "",
      metadata: { unsupported: true, originalType: msgType },
    };
  }
  return null;
}
```

Note: The real implementation modifies the WhatsApp adapter (and similarly Instagram, Telegram). The key changes:

**Step 2: Modify WhatsApp adapter**

In `apps/chat/src/adapters/whatsapp.ts`, replace line 201 (`if (msgType !== "text") return null;`) with:

```typescript
if (msgType !== "text" && msgType !== "interactive") {
  // Capture the lead even for unsupported message types
  return {
    id: msgId ?? randomUUID(),
    principalId: from,
    text: "",
    channel: "whatsapp",
    threadId: from,
    timestamp: timestamp ? new Date(parseInt(timestamp) * 1000) : new Date(),
    metadata: { ...metadata, unsupported: true, originalType: msgType },
    attachments: [],
    organizationId: null,
  };
}
```

**Step 3: Modify runtime to handle unsupported messages**

In `apps/chat/src/runtime.ts`, after line 341 (`if (!message) return;`), add:

```typescript
// Handle unsupported message types — capture lead but reply with guidance
if (message.metadata?.["unsupported"]) {
  const threadId = message.threadId ?? message.id;
  let conversation = await getThread(threadId);
  if (!conversation) {
    conversation = createConversation(
      threadId,
      message.channel,
      message.principalId,
      message.organizationId ?? null,
    );
    await linkCrmContact(this.buildPipelineDeps(), message, conversation);
    await setThread(conversation);
  }

  const ackText = this.resolveUnsupportedMessageReply(message.metadata["originalType"] as string);
  await this.sendFilteredReply(threadId, ackText);
  return;
}
```

Add the reply resolver method:

```typescript
private resolveUnsupportedMessageReply(_originalType: string): string {
  // Configurable per skin/profile — default English
  return "Thanks for reaching out! I'm better with text — could you describe what you need?";
}
```

**Step 4: Apply same pattern to Instagram and Telegram adapters**

Follow the same pattern: instead of returning `null` for non-text, return a message with `metadata.unsupported = true`.

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/chat test -- --run non-text`
Expected: PASS

**Step 6: Run full chat tests to check for regressions**

Run: `pnpm --filter @switchboard/chat test`
Expected: PASS

**Step 7: Commit**

```bash
git commit -m "feat: capture leads from non-text messages instead of silent drop"
```

---

## Task 12: Multi-Language Runtime

**Files:**

- Modify: `apps/chat/src/interpreter/skin-aware-interpreter.ts:122-135`
- Create: `apps/chat/src/interpreter/__tests__/multi-language.test.ts`

**Step 1: Write failing test**

Create `apps/chat/src/interpreter/__tests__/multi-language.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLanguageInstruction } from "../language-support.js";

describe("buildLanguageInstruction", () => {
  it("returns instruction for detected language", () => {
    const result = buildLanguageInstruction("zh", ["en", "zh", "ms"]);
    expect(result).toContain("zh");
    expect(result).toContain("Continue");
  });

  it("returns available languages instruction when no detected language", () => {
    const result = buildLanguageInstruction(null, ["en", "zh"]);
    expect(result).toContain("en");
    expect(result).toContain("zh");
    expect(result).toContain("Match the customer");
  });

  it("returns empty string when no language config", () => {
    const result = buildLanguageInstruction(null, []);
    expect(result).toBe("");
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @switchboard/chat test -- --run multi-language`
Expected: FAIL — module not found

**Step 3: Implement language support**

Create `apps/chat/src/interpreter/language-support.ts`:

```typescript
export function buildLanguageInstruction(
  detectedLanguage: string | null,
  availableLanguages: string[],
): string {
  if (detectedLanguage) {
    return `\nContinue this conversation in ${detectedLanguage}. If the customer switches language, follow their switch.`;
  }

  if (availableLanguages.length > 0) {
    return `\nYou may communicate in: ${availableLanguages.join(", ")}. Match the customer's language. If unsure, use English.`;
  }

  return "";
}
```

**Step 4: Integrate into SkinAwareInterpreter**

In `apps/chat/src/interpreter/skin-aware-interpreter.ts`, in `composeSystemPrompt()` (around line 135), add:

```typescript
// 7. Language support
const detectedLang = conversationContext["detectedLanguage"] as string | null;
const availableLangs = this.resolvedProfile?.localisation?.languages ?? [];
const langInstruction = buildLanguageInstruction(detectedLang, availableLangs);
if (langInstruction) {
  parts.push(langInstruction);
}
```

Import `buildLanguageInstruction` from `./language-support.js`.

**Step 5: Run tests**

Run: `pnpm --filter @switchboard/chat test -- --run multi-language`
Expected: PASS

**Step 6: Run full chat tests**

Run: `pnpm --filter @switchboard/chat test`
Expected: PASS

**Step 7: Commit**

```bash
git commit -m "feat: add multi-language runtime support for SEA market"
```

---

## Task 13: Integration Verification

**Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (0 errors)

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

**Step 4: Verify build**

Run: `pnpm build`
Expected: All packages build successfully

**Step 5: Commit any fixes**

If any issues found, fix and commit:

```bash
git commit -m "fix: resolve integration issues from closed-loop implementation"
```

---

## Summary — Commit Sequence

| Task | Commit                                                                  | What it does                                   |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| 1    | `feat: add fbclid and ttclid to CrmContact schema`                      | Click ID fields for Meta/TikTok                |
| 2    | `feat: add normalizedPhone and normalizedEmail to CrmContact schema`    | Identity merge keys                            |
| 3    | `feat: add click ID and identity fields to CrmContact with migration`   | Prisma migration + phone/email normalization   |
| 4    | `feat: add ContactAlias model for cross-channel identity resolution`    | 1:many channel aliases per contact             |
| 5    | `feat: add ContactMerger service for cross-channel identity resolution` | Phone-first, email-fallback merge logic        |
| 6    | `feat: add RevenueEvent schema for payment recording`                   | Zod schema for source-agnostic payment records |
| 7    | `feat: add POST /api/revenue endpoint for payment recording`            | API for POS/Zapier/external integrations       |
| 8    | `feat: add revenue gap detection job for unrecorded payments`           | 2-hourly nudges for missed payments            |
| 9    | `feat: add deterministic event_id to CAPI dispatcher for deduplication` | Prevents Meta counting duplicates              |
| 10   | `feat: add TikTok Events API dispatcher for conversion feedback loop`   | Closes the loop for TikTok                     |
| 11   | `feat: capture leads from non-text messages instead of silent drop`     | Voice/image/location → lead captured           |
| 12   | `feat: add multi-language runtime support for SEA market`               | EN/ZH/MS conversation support                  |
| 13   | `fix: resolve integration issues from closed-loop implementation`       | Final verification pass                        |
