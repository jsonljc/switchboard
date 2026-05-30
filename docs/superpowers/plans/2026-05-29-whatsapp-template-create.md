# WhatsApp In-Product Template Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator create a WhatsApp message template from inside Switchboard (a Dialog builder posting to a new API route), so the Meta App Review video for `whatsapp_business_management` demonstrates the permission in-product rather than via Postman.

**Architecture:** Four isolated layers mirroring the existing send-test slice — a Zod request schema (`packages/schemas`), a mutating Fastify route reusing `graphPost`/`isRetryable` (`apps/api`), a react-query mutation hook that refetches the template list, and a `Dialog` form wired into the existing Templates card. A throwaway seed (uncommitted) lights up the page. **CORRECTION (verified during impl):** `/api/dashboard/*` is **NOT** middleware-forwarded — there is no generic `apps/dashboard/src/middleware.ts` forward. Each dashboard endpoint needs its own Next route handler under `apps/dashboard/src/app/api/dashboard/whatsapp/{account,phone-numbers,templates}/route.ts` plus an api-client method (`apps/dashboard/src/lib/api-client/whatsapp.ts`, forwarding status+body). Without these the page never loads in-browser. See `[[feedback_dashboard_api_needs_next_proxy_route]]`.

**Tech Stack:** TypeScript (ESM, `.js` relative imports), Zod, Fastify, Next.js 14 + React, @tanstack/react-query, Vitest, Prisma. Spec: `docs/superpowers/specs/2026-05-29-whatsapp-template-create-design.md`.

**Branch:** `feat/whatsapp-template-create` (worktree at `.claude/worktrees/whatsapp-template-create`, off `origin/main`). Tasks 1–4 are committed there; Task 5 (seed) is **never committed**.

---

## Task 1: Request schema + validation (`packages/schemas`)

**Files:**

- Create: `packages/schemas/src/whatsapp-template-create.ts`
- Test: `packages/schemas/src/__tests__/whatsapp-template-create.test.ts`
- Modify: `packages/schemas/src/index.ts:174` (add barrel line)

- [ ] **Step 1: Write the failing test**

Create `packages/schemas/src/__tests__/whatsapp-template-create.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WhatsAppCreateTemplateRequestSchema } from "../whatsapp-template-create.js";

const base = {
  name: "order_update",
  language: "en_US",
  category: "MARKETING" as const,
  body: { text: "Hello, your order is on its way." },
};

describe("WhatsAppCreateTemplateRequestSchema", () => {
  it("accepts a minimal BODY-only template", () => {
    expect(WhatsAppCreateTemplateRequestSchema.parse(base)).toMatchObject(base);
  });

  it("rejects an uppercase / spaced name", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({ ...base, name: "Order Update" }),
    ).toThrow();
  });

  it("accepts body variables with matching examples", () => {
    expect(
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        body: { text: "Hi {{1}}, your code is {{2}}.", examples: ["Ada", "1234"] },
      }),
    ).toBeTruthy();
  });

  it("rejects body variables with the wrong number of examples", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        body: { text: "Hi {{1}}, your code is {{2}}.", examples: ["Ada"] },
      }),
    ).toThrow();
  });

  it("rejects a footer containing a variable", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({ ...base, footer: { text: "Ref {{1}}" } }),
    ).toThrow();
  });

  it("rejects a header with more than one variable", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({ ...base, header: { text: "{{1}} {{2}}" } }),
    ).toThrow();
  });

  it("accepts QUICK_REPLY / URL / PHONE_NUMBER buttons", () => {
    expect(
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [
          { type: "QUICK_REPLY", text: "Stop" },
          { type: "URL", text: "Track", url: "https://example.com/track" },
          { type: "PHONE_NUMBER", text: "Call", phoneNumber: "+15551234567" },
        ],
      }),
    ).toBeTruthy();
  });

  it("rejects more than 2 URL buttons", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [
          { type: "URL", text: "A", url: "https://a.com" },
          { type: "URL", text: "B", url: "https://b.com" },
          { type: "URL", text: "C", url: "https://c.com" },
        ],
      }),
    ).toThrow();
  });

  it("rejects more than 1 PHONE_NUMBER button", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [
          { type: "PHONE_NUMBER", text: "A", phoneNumber: "+15551112222" },
          { type: "PHONE_NUMBER", text: "B", phoneNumber: "+15553334444" },
        ],
      }),
    ).toThrow();
  });

  it("rejects an invalid URL and a non-E.164 phone", () => {
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [{ type: "URL", text: "X", url: "not-a-url" }],
      }),
    ).toThrow();
    expect(() =>
      WhatsAppCreateTemplateRequestSchema.parse({
        ...base,
        buttons: [{ type: "PHONE_NUMBER", text: "X", phoneNumber: "5551234567" }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/schemas test whatsapp-template-create`
Expected: FAIL — `Cannot find module '../whatsapp-template-create.js'`.

- [ ] **Step 3: Write the schema**

Create `packages/schemas/src/whatsapp-template-create.ts`:

```ts
import { z } from "zod";

const E164 = /^\+[1-9]\d{6,14}$/;

/** Count distinct `{{n}}` placeholders in a string. */
function countVariables(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!matches) return 0;
  return new Set(matches.map((m) => m.replace(/\D/g, ""))).size;
}

const HeaderSchema = z.object({ text: z.string().min(1).max(60) });
const BodySchema = z.object({
  text: z.string().min(1).max(1024),
  examples: z.array(z.string().min(1)).optional(),
});
const FooterSchema = z.object({ text: z.string().min(1).max(60) });

const ButtonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().min(1).max(25) }),
  z.object({ type: z.literal("URL"), text: z.string().min(1).max(25), url: z.string().url() }),
  z.object({
    type: z.literal("PHONE_NUMBER"),
    text: z.string().min(1).max(25),
    phoneNumber: z.string().regex(E164, "phoneNumber must be E.164 (e.g. +15551234567)"),
  }),
]);

export const WhatsAppCreateTemplateRequestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, "name must be lowercase letters, digits, and underscores only"),
    language: z
      .string()
      .min(2)
      .max(16)
      .regex(/^[a-zA-Z_-]+$/, "language must be ISO-like, e.g. en_US"),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    header: HeaderSchema.optional(),
    body: BodySchema,
    footer: FooterSchema.optional(),
    buttons: z.array(ButtonSchema).max(10, "at most 10 buttons allowed").optional(),
  })
  .superRefine((val, ctx) => {
    if (val.header && countVariables(val.header.text) > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["header", "text"],
        message: "header may contain at most one {{1}} variable",
      });
    }
    if (val.footer && countVariables(val.footer.text) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["footer", "text"],
        message: "footer must not contain variables",
      });
    }
    const bodyVars = countVariables(val.body.text);
    const sampleCount = val.body.examples?.length ?? 0;
    if (bodyVars !== sampleCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body", "examples"],
        message: `body has ${bodyVars} variable(s) but ${sampleCount} example(s); each {{n}} needs exactly one sample`,
      });
    }
    if (val.buttons) {
      const urls = val.buttons.filter((b) => b.type === "URL").length;
      const phones = val.buttons.filter((b) => b.type === "PHONE_NUMBER").length;
      if (urls > 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["buttons"],
          message: "at most 2 URL buttons allowed",
        });
      }
      if (phones > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["buttons"],
          message: "at most 1 PHONE_NUMBER button allowed",
        });
      }
    }
  });

export type WhatsAppCreateTemplateRequest = z.infer<typeof WhatsAppCreateTemplateRequestSchema>;
```

- [ ] **Step 4: Add the barrel export**

In `packages/schemas/src/index.ts`, immediately after line 174 (`export * from "./whatsapp-test-send.js";`) add:

```ts
export * from "./whatsapp-template-create.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @switchboard/schemas test whatsapp-template-create`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/whatsapp-template-create.ts packages/schemas/src/__tests__/whatsapp-template-create.test.ts packages/schemas/src/index.ts
git commit -m "feat(whatsapp): add create-template request schema"
```

---

## Task 2: API route `POST /templates` (`apps/api`)

**Files:**

- Modify: `apps/api/src/routes/whatsapp-send-test.ts` (add a `code === 100` branch to `graphPost`)
- Create: `apps/api/src/routes/whatsapp-template-create.ts`
- Modify: `apps/api/src/bootstrap/routes.ts` (import at line 45-area, register at line 186-area)
- Test: `apps/api/src/routes/__tests__/whatsapp-template-create.test.ts`

> **Why touch `graphPost`:** Meta returns `code 100` / HTTP 400 for invalid template params. `graphPost` currently maps unknown codes to `WHATSAPP_UPSTREAM_ERROR` (502) and does **not** surface `res.status`, so the create route can't distinguish a validation rejection from a real 502 without this. Adding a `code === 100` branch is additive (no existing send-test test triggers it) and benefits both routes. This is the spec's `WHATSAPP_TEMPLATE_INVALID` mapping, placed in the shared helper rather than locally because the route has no other way to see the 400.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/__tests__/whatsapp-template-create.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { whatsappTemplateCreateRoutes } from "../whatsapp-template-create.js";

const ORG = "org_dev";
const WABA = "103516422734968";

function buildApp(opts: { connection?: unknown; graphApiFetch: typeof fetch }): FastifyInstance {
  const app = Fastify();
  // Minimal auth + prisma stand-ins matching how the route reads them.
  app.addHook("onRequest", async (req) => {
    (req as unknown as { organizationIdFromAuth?: string }).organizationIdFromAuth = ORG;
  });
  (app as unknown as { prisma: unknown }).prisma = {
    connection: { findFirst: async () => opts.connection ?? null },
  };
  return app;
}

const validBody = {
  name: "order_update",
  language: "en_US",
  category: "MARKETING",
  body: { text: "Hello {{1}}.", examples: ["Ada"] },
};

beforeEach(() => {
  process.env.META_SYSTEM_USER_TOKEN = "test-token";
});

describe("POST /templates", () => {
  it("creates a template and returns PENDING", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ id: "123", status: "PENDING", category: "MARKETING" }), {
        status: 200,
      })) as unknown as typeof fetch;
    const app = buildApp({
      connection: { externalAccountId: WABA },
      graphApiFetch: fetchImpl,
    });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({ method: "POST", url: "/templates", payload: validBody });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "123", status: "PENDING", category: "MARKETING" });
  });

  it("400s on an invalid request body", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const app = buildApp({ connection: { externalAccountId: WABA }, graphApiFetch: fetchImpl });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({
      method: "POST",
      url: "/templates",
      payload: { ...validBody, name: "Bad Name" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("WHATSAPP_BAD_REQUEST");
  });

  it("404s when no whatsapp connection exists", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const app = buildApp({ connection: null, graphApiFetch: fetchImpl });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({ method: "POST", url: "/templates", payload: validBody });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("WHATSAPP_NOT_CONNECTED");
  });

  it("maps Meta code 100 to a 400 WHATSAPP_TEMPLATE_INVALID", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { code: 100, message: "Invalid parameter" } }), {
        status: 400,
      })) as unknown as typeof fetch;
    const app = buildApp({ connection: { externalAccountId: WABA }, graphApiFetch: fetchImpl });
    await app.register(whatsappTemplateCreateRoutes, { graphApiFetch: fetchImpl });
    const res = await app.inject({ method: "POST", url: "/templates", payload: validBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("WHATSAPP_TEMPLATE_INVALID");
    expect(res.json().error.message).toContain("Invalid parameter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/api test whatsapp-template-create`
Expected: FAIL — cannot find `../whatsapp-template-create.js`.

- [ ] **Step 3: Add the `code === 100` branch to `graphPost`**

In `apps/api/src/routes/whatsapp-send-test.ts`, inside `graphPost`, add this branch immediately **before** the existing `if (code === 132000 || code === 132001)` line:

```ts
if (code === 100 || res.status === 400)
  return { ok: false, code: "WHATSAPP_TEMPLATE_INVALID", message, httpStatus: 400 };
```

(`WHATSAPP_TEMPLATE_INVALID` is intentionally absent from `isRetryable`, so it stays non-retryable.)

- [ ] **Step 4: Write the route**

Create `apps/api/src/routes/whatsapp-template-create.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import {
  WhatsAppCreateTemplateRequestSchema,
  type WhatsAppCreateTemplateRequest,
} from "@switchboard/schemas";
import { graphPost, isRetryable } from "./whatsapp-send-test.js";

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

export interface TemplateCreateOptions {
  graphApiFetch?: typeof fetch;
}

interface GraphComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT";
  text?: string;
  example?: Record<string, unknown>;
  buttons?: Array<Record<string, unknown>>;
}

/** Translate the validated request into Meta's `components[]` payload. */
function toComponents(req: WhatsAppCreateTemplateRequest): GraphComponent[] {
  const components: GraphComponent[] = [];
  if (req.header) {
    components.push({ type: "HEADER", format: "TEXT", text: req.header.text });
  }
  const body: GraphComponent = { type: "BODY", text: req.body.text };
  if (req.body.examples && req.body.examples.length > 0) {
    body.example = { body_text: [req.body.examples] };
  }
  components.push(body);
  if (req.footer) {
    components.push({ type: "FOOTER", text: req.footer.text });
  }
  if (req.buttons && req.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: req.buttons.map((b) => {
        if (b.type === "URL") return { type: "URL", text: b.text, url: b.url };
        if (b.type === "PHONE_NUMBER")
          return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }
  return components;
}

export const whatsappTemplateCreateRoutes: FastifyPluginAsync<TemplateCreateOptions> = async (
  app,
  opts,
) => {
  const fetchImpl = opts.graphApiFetch ?? fetch;

  app.post("/templates", async (request, reply) => {
    const orgId = (request as unknown as { organizationIdFromAuth?: string })
      .organizationIdFromAuth;
    if (!orgId) {
      return reply.code(401).send({
        error: { code: "AUTH_REQUIRED", message: "Authentication required", retryable: false },
      });
    }

    const parsed = WhatsAppCreateTemplateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: "WHATSAPP_BAD_REQUEST",
          message: parsed.error.issues.map((i) => i.message).join("; "),
          retryable: false,
        },
      });
    }
    const body = parsed.data;

    const conn = await app.prisma!.connection.findFirst({
      where: { organizationId: orgId, serviceId: "whatsapp" },
    });
    if (!conn) {
      return reply.code(404).send({
        error: {
          code: "WHATSAPP_NOT_CONNECTED",
          message: "No WhatsApp connection found",
          retryable: false,
        },
      });
    }
    const wabaId = conn.externalAccountId;
    if (!wabaId) {
      return reply.code(500).send({
        error: {
          code: "WHATSAPP_WABA_MISSING",
          message: "Connection has no externalAccountId (WABA)",
          retryable: false,
        },
      });
    }
    const token = process.env.META_SYSTEM_USER_TOKEN ?? "";
    if (!token) {
      return reply.code(500).send({
        error: {
          code: "WHATSAPP_TOKEN_MISSING",
          message: "META_SYSTEM_USER_TOKEN is not configured",
          retryable: false,
        },
      });
    }

    const graphBody = {
      name: body.name,
      language: body.language,
      category: body.category,
      components: toComponents(body),
    };
    const result = await graphPost(
      `${GRAPH_BASE}/${wabaId}/message_templates`,
      graphBody,
      token,
      fetchImpl,
    );
    if (!result.ok) {
      return reply.code(result.httpStatus).send({
        error: { code: result.code, message: result.message, retryable: isRetryable(result.code) },
      });
    }
    const data = result.data as { id?: string; status?: string; category?: string };
    return reply.code(200).send({
      id: data.id ?? null,
      status: data.status ?? "PENDING",
      category: data.category ?? body.category,
    });
  });
};
```

- [ ] **Step 5: Register the route**

In `apps/api/src/bootstrap/routes.ts`, after line 45 (`import { whatsappSendTestRoutes } ...`) add:

```ts
import { whatsappTemplateCreateRoutes } from "../routes/whatsapp-template-create.js";
```

After line 186 (`await app.register(whatsappSendTestRoutes, ...)`) add:

```ts
await app.register(whatsappTemplateCreateRoutes, { prefix: "/api/dashboard/whatsapp" });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @switchboard/api test whatsapp-template-create` then `pnpm --filter @switchboard/api test whatsapp-send-test`
Expected: both PASS (the send-test suite still green after the `graphPost` addition).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/whatsapp-template-create.ts apps/api/src/routes/whatsapp-send-test.ts apps/api/src/routes/__tests__/whatsapp-template-create.test.ts apps/api/src/bootstrap/routes.ts
git commit -m "feat(whatsapp): add POST /templates create route"
```

---

## Task 3: Mutation hook (`apps/dashboard`)

**Files:**

- Create: `apps/dashboard/src/hooks/use-whatsapp-template-create.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-whatsapp-template-create.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/hooks/__tests__/use-whatsapp-template-create.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useCreateWhatsAppTemplate } from "../use-whatsapp-template-create.js";

vi.mock("@/hooks/use-query-keys", () => ({
  useScopedQueryKeys: () => ({ whatsappManagement: { templates: () => ["wa", "templates"] } }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const body = {
  name: "order_update",
  language: "en_US",
  category: "MARKETING" as const,
  body: { text: "Hello." },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useCreateWhatsAppTemplate", () => {
  it("posts to the create endpoint and resolves the result", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "1", status: "PENDING", category: "MARKETING" }), {
          status: 200,
        }),
      );
    const { result } = renderHook(() => useCreateWhatsAppTemplate(), { wrapper });
    result.current.mutate(body);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/whatsapp/templates",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.data).toMatchObject({ id: "1", status: "PENDING" });
  });

  it("throws the server error message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "WHATSAPP_TEMPLATE_INVALID", message: "bad name", retryable: false } }), {
        status: 400,
      }),
    );
    const { result } = renderHook(() => useCreateWhatsAppTemplate(), { wrapper });
    result.current.mutate(body);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("bad name");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test use-whatsapp-template-create`
Expected: FAIL — cannot find `../use-whatsapp-template-create.js`.

- [ ] **Step 3: Write the hook**

Create `apps/dashboard/src/hooks/use-whatsapp-template-create.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { WhatsAppCreateTemplateRequest } from "@switchboard/schemas";

export interface CreateTemplateResult {
  id: string | null;
  status: string;
  category: string;
}

interface ApiError {
  error: { code: string; message: string; retryable: boolean };
}

async function postCreateTemplate(
  body: WhatsAppCreateTemplateRequest,
): Promise<CreateTemplateResult> {
  const res = await fetch("/api/dashboard/whatsapp/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(err.error?.message ?? `Create template failed (${res.status})`);
  }
  return (await res.json()) as CreateTemplateResult;
}

export function useCreateWhatsAppTemplate() {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: postCreateTemplate,
    onSuccess: () => {
      if (keys) {
        void queryClient.invalidateQueries({ queryKey: keys.whatsappManagement.templates() });
      }
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test use-whatsapp-template-create`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/hooks/use-whatsapp-template-create.ts apps/dashboard/src/hooks/__tests__/use-whatsapp-template-create.test.ts
git commit -m "feat(whatsapp): add useCreateWhatsAppTemplate mutation hook"
```

---

## Task 4: Dialog builder + wire into the Templates card (`apps/dashboard`)

**Files:**

- Create: `apps/dashboard/src/components/settings/whatsapp-template-create.tsx`
- Modify: `apps/dashboard/src/components/settings/whatsapp-management.tsx` (replace the external `Create Template` `<a>` in `TemplatesSection`)
- Test: `apps/dashboard/src/components/settings/__tests__/whatsapp-template-create.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/settings/__tests__/whatsapp-template-create.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { CreateTemplateDialog } from "../whatsapp-template-create.js";

const mutate = vi.fn();
vi.mock("@/hooks/use-whatsapp-template-create", () => ({
  useCreateWhatsAppTemplate: () => ({ mutate, isPending: false, isError: false, error: null }),
}));

function renderDialog() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CreateTemplateDialog />
    </QueryClientProvider>,
  );
}

describe("CreateTemplateDialog", () => {
  it("opens the dialog and shows a sample input when the body has a variable", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));
    const bodyField = await screen.findByLabelText(/body/i);
    fireEvent.change(bodyField, { target: { value: "Hi {{1}}" } });
    expect(await screen.findByLabelText(/sample for \{\{1\}\}/i)).toBeInTheDocument();
  });

  it("submits a valid template via the mutation", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));
    fireEvent.change(await screen.findByLabelText(/template name/i), {
      target: { value: "order_update" },
    });
    fireEvent.change(screen.getByLabelText(/^body/i), { target: { value: "Hello." } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({
      name: "order_update",
      body: { text: "Hello." },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test whatsapp-template-create.test`
Expected: FAIL — cannot find `../whatsapp-template-create.js`.

- [ ] **Step 3: Write the dialog component**

Create `apps/dashboard/src/components/settings/whatsapp-template-create.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import {
  WhatsAppCreateTemplateRequestSchema,
  type WhatsAppCreateTemplateRequest,
} from "@switchboard/schemas";
import { useCreateWhatsAppTemplate } from "@/hooks/use-whatsapp-template-create";

type ButtonDraft =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string }
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string };

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

function countVariables(text: string): number {
  const m = text.match(/\{\{\s*\d+\s*\}\}/g);
  if (!m) return 0;
  return new Set(m.map((s) => s.replace(/\D/g, ""))).size;
}

export function CreateTemplateDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateWhatsAppTemplate();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("MARKETING");
  const [language, setLanguage] = useState("en_US");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);

  const varCount = useMemo(() => countVariables(bodyText), [bodyText]);
  // Keep the samples array length in sync with the variable count.
  const visibleSamples = Array.from({ length: varCount }, (_, i) => samples[i] ?? "");

  function setSample(i: number, value: string) {
    setSamples((prev) => {
      const next = [...prev];
      next[i] = value;
      return next;
    });
  }

  function buildRequest(): WhatsAppCreateTemplateRequest {
    return {
      name,
      language,
      category,
      ...(headerText ? { header: { text: headerText } } : {}),
      body: { text: bodyText, ...(varCount > 0 ? { examples: visibleSamples } : {}) },
      ...(footerText ? { footer: { text: footerText } } : {}),
      ...(buttons.length > 0 ? { buttons } : {}),
    };
  }

  function handleSubmit() {
    setClientError(null);
    const candidate = buildRequest();
    const parsed = WhatsAppCreateTemplateRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      setClientError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    create.mutate(parsed.data, { onSuccess: () => setOpen(false) });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Create Template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create message template</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="order_update"
            />
            <p className="text-xs text-muted-foreground">Lowercase letters, digits, underscores.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tpl-category">Category</Label>
              <select
                id="tpl-category"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-language">Language</Label>
              <Input
                id="tpl-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tpl-header">Header (optional)</Label>
            <Input
              id="tpl-header"
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Order update"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tpl-body">Body</Label>
            <Textarea
              id="tpl-body"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Hi {{1}}, your order {{2}} has shipped."
              rows={3}
            />
          </div>

          {visibleSamples.map((s, i) => (
            <div key={i} className="grid gap-2">
              <Label htmlFor={`tpl-sample-${i}`}>{`Sample for {{${i + 1}}}`}</Label>
              <Input
                id={`tpl-sample-${i}`}
                value={s}
                onChange={(e) => setSample(i, e.target.value)}
              />
            </div>
          ))}

          <div className="grid gap-2">
            <Label htmlFor="tpl-footer">Footer (optional)</Label>
            <Input
              id="tpl-footer"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Buttons (optional)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setButtons((b) => [...b, { type: "QUICK_REPLY", text: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {buttons.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  aria-label={`button ${i + 1} type`}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={b.type}
                  onChange={(e) => {
                    const type = e.target.value as ButtonDraft["type"];
                    setButtons((prev) =>
                      prev.map((x, xi) =>
                        xi === i
                          ? type === "URL"
                            ? { type, text: x.text, url: "" }
                            : type === "PHONE_NUMBER"
                              ? { type, text: x.text, phoneNumber: "" }
                              : { type, text: x.text }
                          : x,
                      ),
                    );
                  }}
                >
                  <option value="QUICK_REPLY">quick reply</option>
                  <option value="URL">url</option>
                  <option value="PHONE_NUMBER">phone</option>
                </select>
                <Input
                  aria-label={`button ${i + 1} text`}
                  placeholder="Label"
                  value={b.text}
                  onChange={(e) =>
                    setButtons((prev) =>
                      prev.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)),
                    )
                  }
                />
                {b.type === "URL" && (
                  <Input
                    aria-label={`button ${i + 1} url`}
                    placeholder="https://"
                    value={b.url}
                    onChange={(e) =>
                      setButtons((prev) =>
                        prev.map((x, xi) =>
                          xi === i && x.type === "URL" ? { ...x, url: e.target.value } : x,
                        ),
                      )
                    }
                  />
                )}
                {b.type === "PHONE_NUMBER" && (
                  <Input
                    aria-label={`button ${i + 1} phone`}
                    placeholder="+15551234567"
                    value={b.phoneNumber}
                    onChange={(e) =>
                      setButtons((prev) =>
                        prev.map((x, xi) =>
                          xi === i && x.type === "PHONE_NUMBER"
                            ? { ...x, phoneNumber: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`remove button ${i + 1}`}
                  onClick={() => setButtons((prev) => prev.filter((_, xi) => xi !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {(clientError || create.isError) && (
            <p className="text-sm text-destructive">{clientError ?? create.error?.message}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire it into the Templates card**

In `apps/dashboard/src/components/settings/whatsapp-management.tsx`:

Add an import near the top (after the `WhatsAppSendTest` import, line ~28):

```ts
import { CreateTemplateDialog } from "./whatsapp-template-create";
```

In `TemplatesSection`, replace the `<Button variant="outline" size="sm" asChild>…Create Template…</Button>` block (the `<a href={metaUrl}…>`) in the `CardHeader` with:

```tsx
<CreateTemplateDialog />
```

The now-unused `metaUrl`, `ExternalLink` import, and `wabaId` prop become dead — remove `metaUrl` and its `wabaId` usage in `TemplatesSection`, drop `wabaId` from the `TemplatesSection` props and its call site (`wabaId={account.data.account.id}`), and remove `ExternalLink` from the `lucide-react` import if no longer used elsewhere in the file. Run `pnpm --filter @switchboard/dashboard typecheck` to confirm no remaining references.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @switchboard/dashboard test whatsapp-template-create.test`
Expected: PASS (2 tests).
Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: exit 0 (verifies the dead-code removal in Step 4 left no dangling refs; recall `Input`/`Label`/`Textarea` exist under `components/ui/` — confirm import paths resolve).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/components/settings/whatsapp-template-create.tsx apps/dashboard/src/components/settings/whatsapp-management.tsx apps/dashboard/src/components/settings/__tests__/whatsapp-template-create.test.tsx
git commit -m "feat(whatsapp): in-product create-template dialog"
```

---

## Task 5: Throwaway seed to light up the page (NOT COMMITTED)

> This task modifies the **uncommitted** `packages/db/demo-whatsapp-seed.mts` in the **main repo working tree** (the worktree shares the same `DATABASE_URL`). It is **never committed** — same rule as `.env`. It exists only so `/settings/channels/whatsapp` reports `connected` and live-lists the real WABA/templates during filming.

**Files:**

- Modify (main repo, uncommitted): `packages/db/demo-whatsapp-seed.mts`

- [ ] **Step 1: Add a `connection` mode**

Add this function and wire it into the `mode` switch (near the existing `inspect | seed | approvals | cleanup | verify` dispatch):

```ts
async function seedConnection() {
  const u = await prisma.dashboardUser.findFirst({ select: { organizationId: true } });
  const orgId = u?.organizationId;
  if (!orgId) throw new Error("No dashboardUser/org found to attach the WhatsApp connection to");

  const WABA = "103516422734968";
  const PHONE_ID = "108124008934344";

  let conn = await prisma.connection.findFirst({
    where: { organizationId: orgId, serviceId: "whatsapp" },
  });
  if (conn) {
    conn = await prisma.connection.update({
      where: { id: conn.id },
      data: {
        externalAccountId: WABA,
        credentials: { primaryPhoneNumberId: PHONE_ID },
        status: "connected",
      },
    });
  } else {
    conn = await prisma.connection.create({
      data: {
        serviceId: "whatsapp",
        serviceName: "WhatsApp",
        organizationId: orgId,
        authType: "system_user",
        credentials: { primaryPhoneNumberId: PHONE_ID },
        scopes: [],
        status: "connected",
        externalAccountId: WABA,
      },
    });
  }

  const existingChannel = await prisma.managedChannel.findFirst({
    where: { organizationId: orgId, channel: "whatsapp" },
  });
  if (!existingChannel) {
    await prisma.managedChannel.create({
      data: {
        organizationId: orgId,
        channel: "whatsapp",
        connectionId: conn.id,
        webhookPath: `/webhook/managed/demo-${orgId}`,
        status: "active",
        testRecipients: [],
      },
    });
  }
  console.warn(`Seeded whatsapp Connection ${conn.id} (WABA ${WABA}) for org ${orgId}`);
}
```

Add to the dispatch:

```ts
  else if (mode === "connection") await seedConnection();
```

and extend the `Unknown mode` usage string to include `connection`.

- [ ] **Step 2: Run it against the shared DB**

```bash
cd /Users/jasonli/switchboard
node --env-file=.env --import tsx packages/db/demo-whatsapp-seed.mts connection
node --env-file=.env --import tsx packages/db/demo-whatsapp-seed.mts inspect
```

Expected: the seed logs the created Connection id; `inspect` shows it.

- [ ] **Step 3: Do NOT commit**

Confirm it stays untracked:

```bash
git -C /Users/jasonli/switchboard status --short packages/db/demo-whatsapp-seed.mts
```

Expected: `??` (untracked) — never `git add` it.

---

## Task 6: Full verify + film the video

- [ ] **Step 1: Full local gates (from the worktree)**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/whatsapp-template-create
pnpm --filter @switchboard/schemas test
pnpm --filter @switchboard/api test
pnpm --filter @switchboard/dashboard test
pnpm typecheck
pnpm --filter @switchboard/dashboard build
```

Expected: all green. (`next build` is the only thing that catches dashboard import/`.js`/CSS issues — it is **not** in CI.)

- [ ] **Step 2: Bring up the stack and verify live**

```bash
# API — repo root so root .env loads past turbo env-stripping (:3000)
cd /Users/jasonli/switchboard && node --env-file=.env --import tsx apps/api/src/server.ts
# Dashboard — from the worktree (:3002)
cd /Users/jasonli/switchboard/.claude/worktrees/whatsapp-template-create && pnpm --filter @switchboard/dashboard dev
```

Open `http://localhost:3002/settings/channels/whatsapp`. The page should report **connected** and list the real templates. Click **Create Template**, fill the form, submit → the new template appears as **PENDING** in the list (this is the App Review money shot — it proves `whatsapp_business_management` create from inside the product).

- [ ] **Step 3: Open the implementation PR**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/whatsapp-template-create
git push -u origin feat/whatsapp-template-create
gh pr create --base main --title "feat(whatsapp): in-product message-template creation" --body "Implements docs/superpowers/specs/2026-05-29-whatsapp-template-create-design.md (PR #754). Dialog builder + POST /api/dashboard/whatsapp/templates. Tasks 1-4; seed (Task 5) intentionally not committed."
```

---

## Self-Review

**Spec coverage:**

- Schema layer (Meta validation) → Task 1. ✅
- API route + `WHATSAPP_TEMPLATE_INVALID` mapping → Task 2 (mapping placed in shared `graphPost` because the route can't otherwise see the 400 — noted deviation from the spec's "local" wording). ✅
- Dashboard form (Dialog, full component set) + refetch → Tasks 3 & 4. ✅
- Seed Connection + ManagedChannel (uncommitted) → Task 5. ✅
- Error table (401/400/404/500/`TEMPLATE_INVALID`) → exercised in Task 2 tests + route code. ✅
- Out-of-scope (media headers, edit/delete, approval polling) → not built. ✅

**Placeholder scan:** none — every code step contains complete code; every command has expected output.

**Type consistency:** `WhatsAppCreateTemplateRequest` (schema) flows to the route's `toComponents` and the hook/component import; `CreateTemplateResult` matches the route's `{id,status,category}` response; `keys.whatsappManagement.templates()` matches the read hook's existing key; `graphPost`/`isRetryable` signatures match `whatsapp-send-test.ts`.

**Risk note:** Task 4 references `components/ui/input`, `label`, `textarea` — confirm these exist (`dialog.tsx`, `button.tsx` confirmed). If `Textarea`/`Label` are absent, add the shadcn primitive or substitute an `Input`/native element in the same step before committing.
