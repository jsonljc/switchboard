# Ad Optimizer SP2: Inngest Cron + Widget fbclid + Meta Leads Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Ad Optimizer into Inngest for scheduled audits (weekly full + daily anomaly check), capture fbclid from ad clicks via the chat widget's postMessage bridge, and add a Meta Leads API webhook for ingesting lead form submissions.

**Architecture:** Two Inngest cron functions (weekly audit, daily check) follow the existing factory pattern from the creative pipeline — testable pure-logic function + factory wrapper. The widget fbclid capture uses postMessage from parent page to iframe, extending the visitor data model. Meta Leads ingestion is a new API route that receives webhook payloads from Meta and creates Contact records with attribution data.

**Tech Stack:** Inngest SDK (already installed), Fastify routes, Zod validation, vitest

**Spec:** `docs/superpowers/specs/2026-04-13-ad-optimizer-design.md` — Sections 5.3, 5.4, 14

---

## File Structure

| Action | File                                                                   | Responsibility                                              |
| ------ | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| Create | `packages/core/src/ad-optimizer/inngest-functions.ts`                  | Cron function factories: weekly audit + daily anomaly check |
| Create | `packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts`   | Tests for cron orchestration logic                          |
| Create | `packages/core/src/ad-optimizer/meta-leads-ingester.ts`                | Parse + validate Meta Leads API webhook payloads            |
| Create | `packages/core/src/ad-optimizer/__tests__/meta-leads-ingester.test.ts` | Leads ingester tests                                        |
| Create | `apps/api/src/routes/ad-optimizer.ts`                                  | API routes: leads webhook + on-demand audit trigger         |
| Modify | `apps/api/src/bootstrap/inngest.ts`                                    | Register ad optimizer cron functions                        |
| Modify | `apps/api/src/bootstrap/routes.ts`                                     | Register ad optimizer routes                                |
| Modify | `apps/chat/src/endpoints/widget-embed.ts`                              | Add postMessage listener for fbclid in iframe JS            |
| Modify | `apps/chat/src/endpoints/widget-messages.ts`                           | Extend visitor interface with `fbclid?` field               |
| Modify | `packages/core/src/ad-optimizer/index.ts`                              | Export new modules                                          |
| Create | `packages/db/src/stores/prisma-deployment-store-extensions.ts`         | `listByListing(listingId, status?)` query                   |

---

### Task 1: Deployment Store — listByListing Query

**Files:**

- Modify: `packages/db/src/stores/prisma-deployment-store.ts`
- Modify: `packages/db/src/stores/__tests__/prisma-deployment-store.test.ts` (if exists, else create)

The Inngest cron needs to list all active deployments for the ad-optimizer listing. The current store only has `listByOrg`. We need `listByListing`.

- [ ] **Step 1: Read the existing deployment store**

Read `packages/db/src/stores/prisma-deployment-store.ts` to understand the class structure and existing methods.

- [ ] **Step 2: Add `listByListing` method**

Add to `PrismaDeploymentStore`:

```typescript
async listByListing(
  listingId: string,
  status?: string,
): Promise<AgentDeployment[]> {
  return this.prisma.agentDeployment.findMany({
    where: {
      listingId,
      ...(status ? { status } : {}),
    },
  });
}
```

- [ ] **Step 3: Export from db barrel if needed**

Check `packages/db/src/index.ts` — the store should already be exported.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/stores/prisma-deployment-store.ts && git commit -m "feat(db): add listByListing to deployment store for cron queries"
```

---

### Task 2: Inngest Cron Functions

**Files:**

- Create: `packages/core/src/ad-optimizer/inngest-functions.ts`
- Create: `packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts`

Two cron functions following the creative pipeline factory pattern: testable pure-logic function + factory wrapper.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executeWeeklyAudit,
  executeDailyCheck,
  type CronDependencies,
} from "../inngest-functions.js";

function makeMockStep() {
  return {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  };
}

describe("executeWeeklyAudit", () => {
  let deps: CronDependencies;
  let step: ReturnType<typeof makeMockStep>;

  beforeEach(() => {
    step = makeMockStep();
    deps = {
      listActiveDeployments: vi.fn().mockResolvedValue([
        { id: "dep-1", inputConfig: { monthlyBudget: 1000, targetCPA: 100, targetROAS: 3.0 } },
        { id: "dep-2", inputConfig: { monthlyBudget: 500, targetCPA: 50, targetROAS: 2.0 } },
      ]),
      createAdsClient: vi.fn().mockReturnValue({
        getCampaignInsights: vi.fn().mockResolvedValue([]),
        getAdSetInsights: vi.fn().mockResolvedValue([]),
        getAccountSummary: vi.fn().mockResolvedValue({
          accountId: "act_123",
          accountName: "Test",
          currency: "USD",
          totalSpend: 0,
          totalImpressions: 0,
          totalClicks: 0,
          activeCampaigns: 0,
        }),
      }),
      createCrmProvider: vi.fn().mockReturnValue({
        getFunnelData: vi.fn().mockResolvedValue({ leads: 0, qualified: 0, closed: 0, revenue: 0 }),
        getBenchmarks: vi.fn().mockResolvedValue({
          ctr: 2.5,
          landingPageViewRate: 0.8,
          leadRate: 0.04,
          qualificationRate: 0.4,
          closeRate: 0.3,
        }),
        getCampaignLearningData: vi.fn().mockResolvedValue({
          effectiveStatus: "ACTIVE",
          learningPhase: false,
          lastModifiedDays: 14,
          optimizationEvents: 100,
        }),
        getDaysAboveTarget: vi.fn().mockResolvedValue(0),
      }),
      saveAuditReport: vi.fn().mockResolvedValue(undefined),
      getDeploymentCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        accountId: "act_123",
      }),
    };
  });

  it("runs audit for each active deployment", async () => {
    await executeWeeklyAudit(step, deps);

    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.createAdsClient).toHaveBeenCalledTimes(2);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(2);
  });

  it("skips deployment when credentials are missing", async () => {
    deps.getDeploymentCredentials = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: "token", accountId: "act_123" })
      .mockResolvedValueOnce(null);

    await executeWeeklyAudit(step, deps);

    expect(deps.createAdsClient).toHaveBeenCalledTimes(1);
    expect(deps.saveAuditReport).toHaveBeenCalledTimes(1);
  });
});

describe("executeDailyCheck", () => {
  let deps: CronDependencies;
  let step: ReturnType<typeof makeMockStep>;

  beforeEach(() => {
    step = makeMockStep();
    deps = {
      listActiveDeployments: vi
        .fn()
        .mockResolvedValue([
          { id: "dep-1", inputConfig: { monthlyBudget: 1000, targetCPA: 100, targetROAS: 3.0 } },
        ]),
      createAdsClient: vi.fn().mockReturnValue({
        getAccountSummary: vi.fn().mockResolvedValue({
          accountId: "act_123",
          accountName: "Test",
          currency: "USD",
          totalSpend: 500,
          totalImpressions: 50000,
          totalClicks: 2000,
          activeCampaigns: 3,
        }),
      }),
      createCrmProvider: vi.fn(),
      saveAuditReport: vi.fn(),
      getDeploymentCredentials: vi.fn().mockResolvedValue({
        accessToken: "token",
        accountId: "act_123",
      }),
    };
  });

  it("checks account summary for each deployment", async () => {
    await executeDailyCheck(step, deps);

    expect(deps.listActiveDeployments).toHaveBeenCalledTimes(1);
    expect(deps.getDeploymentCredentials).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx vitest run src/ad-optimizer/__tests__/inngest-functions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement inngest functions**

```typescript
// packages/core/src/ad-optimizer/inngest-functions.ts
import { inngestClient } from "../creative-pipeline/inngest-client.js";
import { AuditRunner } from "./audit-runner.js";
import type { AdsClientInterface, CrmDataProvider, AuditConfig } from "./audit-runner.js";

// ── Dependency Interfaces ────────────────────────────────────────────────────

interface DeploymentInfo {
  id: string;
  inputConfig: {
    monthlyBudget?: number;
    targetCPA?: number;
    targetROAS?: number;
  };
}

interface DeploymentCredentials {
  accessToken: string;
  accountId: string;
}

export interface CronDependencies {
  listActiveDeployments: () => Promise<DeploymentInfo[]>;
  getDeploymentCredentials: (deploymentId: string) => Promise<DeploymentCredentials | null>;
  createAdsClient: (creds: DeploymentCredentials) => AdsClientInterface;
  createCrmProvider: (deploymentId: string) => CrmDataProvider;
  saveAuditReport: (deploymentId: string, report: unknown) => Promise<void>;
}

// ── Step Tools Interface (for testability) ───────────────────────────────────

interface StepTools {
  run: <T>(name: string, fn: () => T | Promise<T>) => Promise<T>;
}

// ── Date Helpers ─────────────────────────────────────────────────────────────

function getWeeklyDateRanges(): {
  dateRange: { since: string; until: string };
  previousDateRange: { since: string; until: string };
} {
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() - 1); // yesterday

  const since = new Date(until);
  since.setDate(since.getDate() - 6); // 7-day window

  const prevUntil = new Date(since);
  prevUntil.setDate(prevUntil.getDate() - 1);

  const prevSince = new Date(prevUntil);
  prevSince.setDate(prevSince.getDate() - 6);

  return {
    dateRange: { since: fmt(since), until: fmt(until) },
    previousDateRange: { since: fmt(prevSince), until: fmt(prevUntil) },
  };
}

function fmt(d: Date): string {
  return d.toISOString().split("T")[0];
}

// ── Pure Logic Functions ─────────────────────────────────────────────────────

export async function executeWeeklyAudit(step: StepTools, deps: CronDependencies): Promise<void> {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());

  const dateRanges = getWeeklyDateRanges();

  for (const deployment of deployments) {
    const creds = await step.run(`creds-${deployment.id}`, () =>
      deps.getDeploymentCredentials(deployment.id),
    );

    if (!creds) continue;

    await step.run(`audit-${deployment.id}`, async () => {
      const config: AuditConfig = {
        accountId: creds.accountId,
        targetCPA: deployment.inputConfig.targetCPA ?? 100,
        targetROAS: deployment.inputConfig.targetROAS ?? 3.0,
      };

      const runner = new AuditRunner({
        adsClient: deps.createAdsClient(creds),
        crmDataProvider: deps.createCrmProvider(deployment.id),
        config,
      });

      const report = await runner.run(dateRanges);
      await deps.saveAuditReport(deployment.id, report);
    });
  }
}

export async function executeDailyCheck(step: StepTools, deps: CronDependencies): Promise<void> {
  const deployments = await step.run("list-deployments", () => deps.listActiveDeployments());

  for (const deployment of deployments) {
    const creds = await step.run(`creds-${deployment.id}`, () =>
      deps.getDeploymentCredentials(deployment.id),
    );

    if (!creds) continue;

    await step.run(`check-${deployment.id}`, async () => {
      const adsClient = deps.createAdsClient(creds);
      const _summary = await adsClient.getAccountSummary();
      // Lightweight check — threshold breach detection is deferred to SP3
      // when dashboard alerting is built
    });
  }
}

// ── Inngest Factory Functions ────────────────────────────────────────────────

export function createWeeklyAuditCron(deps: CronDependencies) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-weekly-audit", name: "Ad Optimizer Weekly Audit", retries: 2 },
    { cron: "0 9 * * 1" }, // Monday 9 AM UTC
    async ({ step }) => {
      await executeWeeklyAudit(step, deps);
    },
  );
}

export function createDailyCheckCron(deps: CronDependencies) {
  return inngestClient.createFunction(
    { id: "ad-optimizer-daily-check", name: "Ad Optimizer Daily Check", retries: 2 },
    { cron: "0 8 * * *" }, // Daily 8 AM UTC
    async ({ step }) => {
      await executeDailyCheck(step, deps);
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx vitest run src/ad-optimizer/__tests__/inngest-functions.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ad-optimizer/inngest-functions.ts packages/core/src/ad-optimizer/__tests__/inngest-functions.test.ts && git commit -m "feat: add Inngest cron functions for weekly audit and daily check"
```

---

### Task 3: Register Inngest Cron in Bootstrap

**Files:**

- Modify: `apps/api/src/bootstrap/inngest.ts`

Wire the new cron functions into the Inngest serve handler.

- [ ] **Step 1: Read the current inngest bootstrap**

Read `apps/api/src/bootstrap/inngest.ts` to see the current structure.

- [ ] **Step 2: Add imports and function registration**

Add to the imports:

```typescript
import {
  PrismaDeploymentStore,
  PrismaListingStore,
  PrismaDeploymentConnectionStore,
  PrismaAgentTaskStore,
} from "@switchboard/db";
import {
  createWeeklyAuditCron,
  createDailyCheckCron,
  MetaAdsClient,
} from "@switchboard/core/ad-optimizer";
import type { CronDependencies } from "@switchboard/core/ad-optimizer";
```

Inside `registerInngest`, after the `jobStore` line, add:

```typescript
// Ad Optimizer cron dependencies
const deploymentStore = new PrismaDeploymentStore(app.prisma);
const listingStore = new PrismaListingStore(app.prisma);
const connectionStore = new PrismaDeploymentConnectionStore(app.prisma);
const taskStore = new PrismaAgentTaskStore(app.prisma);

const adOptimizerDeps: CronDependencies = {
  listActiveDeployments: async () => {
    const listing = await listingStore.findBySlug("ad-optimizer");
    if (!listing) return [];
    const deployments = await deploymentStore.listByListing(listing.id, "active");
    return deployments.map((d) => ({
      id: d.id,
      inputConfig: (d.inputConfig as Record<string, unknown>) ?? {},
    }));
  },
  getDeploymentCredentials: async (deploymentId) => {
    const connections = await connectionStore.listByDeployment(deploymentId);
    const conn = connections.find((c) => c.type === "meta-ads");
    if (!conn) return null;
    // Credentials are encrypted — decryptCredentials is handled by the store
    const creds = JSON.parse(conn.credentials);
    return { accessToken: creds.accessToken, accountId: creds.accountId };
  },
  createAdsClient: (creds) => new MetaAdsClient(creds),
  createCrmProvider: (_deploymentId) => ({
    // Stub CRM provider — real implementation in SP3 when CRM queries are built
    getFunnelData: async () => ({ leads: 0, qualified: 0, closed: 0, revenue: 0 }),
    getBenchmarks: async () => ({
      ctr: 2.5,
      landingPageViewRate: 0.8,
      leadRate: 0.04,
      qualificationRate: 0.4,
      closeRate: 0.3,
    }),
    getCampaignLearningData: async () => ({
      effectiveStatus: "ACTIVE",
      learningPhase: false,
      lastModifiedDays: 30,
      optimizationEvents: 100,
    }),
    getDaysAboveTarget: async () => 0,
  }),
  saveAuditReport: async (deploymentId, report) => {
    // Resolve org + listing from deployment record
    const deployment = await deploymentStore.findById(deploymentId);
    if (!deployment) return;
    const task = await taskStore.create({
      deploymentId,
      organizationId: deployment.organizationId,
      listingId: deployment.listingId,
      category: "audit",
      input: {},
    });
    await taskStore.submitOutput(task.id, report as Record<string, unknown>);
    await taskStore.updateStatus(task.id, "completed");
  },
};
```

Add the cron functions to the `functions` array:

```typescript
functions: [
  createCreativeJobRunner(jobStore, { apiKey }, openaiApiKey ? { openaiApiKey } : undefined),
  createWeeklyAuditCron(adOptimizerDeps),
  createDailyCheckCron(adOptimizerDeps),
],
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api exec tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bootstrap/inngest.ts && git commit -m "feat(api): register ad optimizer cron functions in Inngest bootstrap"
```

---

### Task 4: Widget fbclid Capture — postMessage Listener

**Files:**

- Modify: `apps/chat/src/endpoints/widget-embed.ts`
- Modify: `apps/chat/src/endpoints/widget-messages.ts`

Add postMessage listener in the widget iframe to receive fbclid from the parent page, and extend the message body to include it.

> **Note:** The parent-page embed snippet (the `<script>` tag buyers paste on their site) that extracts `fbclid` from URL params and calls `postMessage` is deferred to the dashboard/docs SP — this task only adds the _receiving_ side inside the widget iframe.

- [ ] **Step 1: Extend WidgetMessageBody visitor interface**

In `apps/chat/src/endpoints/widget-messages.ts`, update the interface:

```typescript
interface WidgetMessageBody {
  sessionId: string;
  text: string;
  visitor?: { name?: string; email?: string; fbclid?: string };
}
```

This is a single-field addition. The `fbclid` flows through `gateway.handleIncoming()` via the existing `visitor` passthrough.

- [ ] **Step 2: Add postMessage listener + fbclid inclusion in widget embed**

In `apps/chat/src/endpoints/widget-embed.ts`, add after the `SESSION_ID` lines (after line 48) in the `<script>` block:

```javascript
// fbclid capture from parent page via postMessage
let SW_FBCLID = null;
window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "sw:init" && e.data.fbclid) {
    SW_FBCLID = e.data.fbclid;
  }
});
```

Then update the `sendMessage` function's fetch body to include fbclid:

Change the existing `body: JSON.stringify({ sessionId: SESSION_ID, text })` to:

```javascript
body: JSON.stringify({ sessionId: SESSION_ID, text, ...(SW_FBCLID ? { visitor: { fbclid: SW_FBCLID } } : {}) }),
```

- [ ] **Step 3: Commit**

```bash
git add apps/chat/src/endpoints/widget-embed.ts apps/chat/src/endpoints/widget-messages.ts && git commit -m "feat(chat): add fbclid capture via postMessage in widget embed"
```

---

### Task 5: Meta Leads API Ingester

**Files:**

- Create: `packages/core/src/ad-optimizer/meta-leads-ingester.ts`
- Create: `packages/core/src/ad-optimizer/__tests__/meta-leads-ingester.test.ts`

Parse and validate incoming Meta Leads API webhook payloads, extracting contact data with ad attribution.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/ad-optimizer/__tests__/meta-leads-ingester.test.ts
import { describe, it, expect } from "vitest";
import { parseLeadWebhook, type LeadData } from "../meta-leads-ingester.js";

describe("parseLeadWebhook", () => {
  it("extracts lead data from valid webhook payload", () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "lead-456",
                ad_id: "ad-789",
                form_id: "form-101",
                field_data: [
                  { name: "full_name", values: ["John Doe"] },
                  { name: "email", values: ["john@example.com"] },
                  { name: "phone_number", values: ["+1234567890"] },
                ],
              },
            },
          ],
        },
      ],
    };

    const leads = parseLeadWebhook(payload);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toEqual({
      leadId: "lead-456",
      adId: "ad-789",
      formId: "form-101",
      name: "John Doe",
      email: "john@example.com",
      phone: "+1234567890",
    });
  });

  it("handles multiple leads in one webhook", () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            {
              field: "leadgen",
              value: { leadgen_id: "lead-1", ad_id: "ad-1", form_id: "f1", field_data: [] },
            },
            {
              field: "leadgen",
              value: { leadgen_id: "lead-2", ad_id: "ad-2", form_id: "f2", field_data: [] },
            },
          ],
        },
      ],
    };

    const leads = parseLeadWebhook(payload);
    expect(leads).toHaveLength(2);
  });

  it("returns empty array for non-leadgen changes", () => {
    const payload = {
      entry: [{ id: "page-123", changes: [{ field: "feed", value: {} }] }],
    };

    expect(parseLeadWebhook(payload)).toHaveLength(0);
  });

  it("handles missing field_data gracefully", () => {
    const payload = {
      entry: [
        {
          id: "page-123",
          changes: [
            { field: "leadgen", value: { leadgen_id: "lead-1", ad_id: "ad-1", form_id: "f1" } },
          ],
        },
      ],
    };

    const leads = parseLeadWebhook(payload);
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBeUndefined();
    expect(leads[0].email).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jasonljc/switchboard && npx vitest run src/ad-optimizer/__tests__/meta-leads-ingester.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement leads ingester**

```typescript
// packages/core/src/ad-optimizer/meta-leads-ingester.ts

// ── Types ────────────────────────────────────────────────────────────────────

export interface LeadData {
  leadId: string;
  adId: string;
  formId: string;
  name?: string;
  email?: string;
  phone?: string;
}

interface FieldData {
  name: string;
  values: string[];
}

interface LeadgenValue {
  leadgen_id: string;
  ad_id: string;
  form_id: string;
  field_data?: FieldData[];
}

interface WebhookChange {
  field: string;
  value: LeadgenValue | Record<string, unknown>;
}

interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

interface WebhookPayload {
  entry: WebhookEntry[];
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseLeadWebhook(payload: unknown): LeadData[] {
  const p = payload as WebhookPayload;
  if (!p?.entry) return [];

  const leads: LeadData[] = [];

  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;

      const value = change.value as LeadgenValue;
      if (!value.leadgen_id) continue;

      const fields = value.field_data ?? [];
      leads.push({
        leadId: value.leadgen_id,
        adId: value.ad_id,
        formId: value.form_id,
        name: findField(fields, "full_name"),
        email: findField(fields, "email"),
        phone: findField(fields, "phone_number"),
      });
    }
  }

  return leads;
}

function findField(fields: FieldData[], name: string): string | undefined {
  const field = fields.find((f) => f.name === name);
  return field?.values?.[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jasonljc/switchboard && npx vitest run src/ad-optimizer/__tests__/meta-leads-ingester.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ad-optimizer/meta-leads-ingester.ts packages/core/src/ad-optimizer/__tests__/meta-leads-ingester.test.ts && git commit -m "feat: add Meta Leads API webhook parser"
```

---

### Task 6: Ad Optimizer API Routes

**Files:**

- Create: `apps/api/src/routes/ad-optimizer.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

Two routes: Meta Leads webhook receiver + webhook verification (GET for Meta's verification challenge).

- [ ] **Step 1: Create the routes file**

```typescript
// apps/api/src/routes/ad-optimizer.ts
import type { FastifyPluginAsync } from "fastify";
import { parseLeadWebhook } from "@switchboard/core/ad-optimizer";

const VERIFY_TOKEN = process.env["META_WEBHOOK_VERIFY_TOKEN"] ?? "switchboard-verify";

export const adOptimizerRoutes: FastifyPluginAsync = async (app) => {
  // Meta Leads webhook verification (GET)
  app.get<{
    Querystring: {
      "hub.mode"?: string;
      "hub.verify_token"?: string;
      "hub.challenge"?: string;
    };
  }>("/leads/webhook", async (request, reply) => {
    const mode = request.query["hub.mode"];
    const token = request.query["hub.verify_token"];
    const challenge = request.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return reply.code(200).send(challenge);
    }
    return reply.code(403).send({ error: "Verification failed" });
  });

  // Meta Leads webhook receiver (POST)
  app.post("/leads/webhook", async (request, reply) => {
    const leads = parseLeadWebhook(request.body);

    if (leads.length === 0) {
      return reply.code(200).send({ received: 0 });
    }

    // TODO (SP3): Create Contact records with attribution data
    // For now, log and acknowledge
    for (const lead of leads) {
      app.log.info(
        { leadId: lead.leadId, adId: lead.adId, email: lead.email ? "[redacted]" : undefined },
        "Received Meta lead",
      );
    }

    return reply.code(200).send({ received: leads.length });
  });
};
```

- [ ] **Step 2: Register in routes bootstrap**

Add to `apps/api/src/bootstrap/routes.ts`:

```typescript
import { adOptimizerRoutes } from "../routes/ad-optimizer.js";
```

And in the registration block:

```typescript
await app.register(adOptimizerRoutes, { prefix: "/api/marketplace" });
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/api exec tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ad-optimizer.ts apps/api/src/bootstrap/routes.ts && git commit -m "feat(api): add Meta Leads webhook route for ad optimizer"
```

---

### Task 7: Update Barrel Exports

**Files:**

- Modify: `packages/core/src/ad-optimizer/index.ts`

- [ ] **Step 1: Add exports for new modules**

Add to `packages/core/src/ad-optimizer/index.ts`:

```typescript
export {
  createWeeklyAuditCron,
  createDailyCheckCron,
  executeWeeklyAudit,
  executeDailyCheck,
} from "./inngest-functions.js";
export type { CronDependencies } from "./inngest-functions.js";
export { parseLeadWebhook } from "./meta-leads-ingester.js";
export type { LeadData } from "./meta-leads-ingester.js";
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/jasonljc/switchboard && npx pnpm@9.15.4 --filter @switchboard/core build
```

- [ ] **Step 3: Run all ad-optimizer tests**

```bash
cd /Users/jasonljc/switchboard && npx vitest run src/ad-optimizer/
```

Expected: All tests pass (59 from SP1 + new from SP2).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ad-optimizer/index.ts && git commit -m "feat: export inngest functions and leads ingester from ad-optimizer barrel"
```

---

## What's Next

This plan covers **Phases 8-9** of the build order. Subsequent plans:

- **SP3:** Facebook OAuth integration (Phase 10) — first OAuth flow in codebase
- **SP4:** Marketplace listing seed data (Phase 11)
- **SP5:** Dashboard — audit summary card, output feed, trend charts (Phase 12)
