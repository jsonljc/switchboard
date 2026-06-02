# Operator BusinessFacts Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a live `/settings/business-facts` dashboard page where a clinic operator enters/edits the rich `BusinessFacts` that live Alex reads, persisting through the already-shipped #813 contract.

**Architecture:** Purely additive dashboard UI on the #813 backend (`GET/PUT …/deployments/:id/business-facts` proxy). New React-Query hooks + a `react-hook-form`/`zodResolver(BusinessFactsSchema)` form composed from section subcomponents. No new API route/proxy; no `builders/alex.ts`/`SKILL.md`/schema/store change (one readiness **comment** only). The org's deployment id is resolved purely as the route's org-ownership anchor.

**Tech Stack:** Next.js 14 App Router, React Query (`@tanstack/react-query`), `react-hook-form` + `@hookform/resolvers/zod`, Radix-based `@/components/ui/*`, Tailwind + `hsl(var(--x))`, vitest + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-06-02-alex-operator-business-facts-editor-design.md`

---

## Conventions (apply to every task)

- **Imports omit `.js`** (relative **and** `@/` alias) — only `next build` catches a missing one.
- **No `any`** — use `unknown` or proper types. ESM, double quotes, 2-space, semis, 100-col (prettier auto-fixes on commit via lint-staged; re-`git add` if it reformats).
- **Commit subject must start lowercase** after `type(scope):` (commitlint `subject-case`).
- **Co-locate tests**; gate React Query loading UI on **`!data && !error`**, never `isLoading` (a disabled query is pending+idle).
- **Run tests** with `.next` removed to avoid the build's `.next/standalone` source copy being double-scanned: `rm -rf apps/dashboard/.next && pnpm --filter @switchboard/dashboard test`.
- Verify branch before each commit: `git branch --show-current` → `feat/alex-business-facts-editor`.

## File structure

**New (all under `apps/dashboard/src`):**

- `hooks/use-deployments.ts` (+ `__tests__/use-deployments.test.ts`) — `useDeployments`, `useOrgDeploymentId`.
- `hooks/use-business-facts.ts` (+ `__tests__/use-business-facts.test.ts`) — `useBusinessFacts`, `useUpsertBusinessFacts`, `BusinessFactsValidationError`.
- `components/settings/business-facts/scaffold.ts` (+ `__tests__/scaffold.test.ts`) — `WEEKDAYS`, `emptyBusinessFacts`, `serializeBusinessFacts`, `BusinessFactsForm`.
- `components/settings/business-facts/hours-section.tsx`, `locations-section.tsx`, `services-section.tsx`, `contact-policies-section.tsx`, `faqs-section.tsx`.
- `components/settings/business-facts/business-facts-form.tsx` (+ `__tests__/business-facts-form.test.tsx`).
- `components/settings/business-facts/__tests__/business-facts-live-path.test.ts` — production-path keystone.
- `app/(auth)/settings/business-facts/page.tsx` (+ `app/__tests__/settings-business-facts-page.test.tsx`).

**Edited:**

- `lib/query-keys.ts` — add `marketplace.businessFacts(deploymentId)`.
- `components/layout/settings-layout.tsx` — add sidebar item.
- `components/onboarding/go-live.tsx` — CTA link on the failing `business-facts-present` advisory row.
- `apps/api/src/routes/readiness.ts` — refresh one stale comment (no logic).

---

## Task 1: query-keys key + deployment-resolution hook

**Files:**

- Modify: `apps/dashboard/src/lib/query-keys.ts:110` (inside `marketplace`)
- Create: `apps/dashboard/src/hooks/use-deployments.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-deployments.test.ts`

- [ ] **Step 1: Add the query key.** In `query-keys.ts`, inside the `marketplace` object, after the `deployments` line, add:

```ts
    businessFacts: (deploymentId: string) =>
      [orgId, "marketplace", "business-facts", deploymentId] as const,
```

- [ ] **Step 2: Write the failing test** `use-deployments.test.ts` (mirror `hooks/__tests__/use-agents.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useDeployments / useOrgDeploymentId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches deployments from the proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deployments: [{ id: "dep_1" }, { id: "dep_2" }] }),
    });
    const { useDeployments } = await import("@/hooks/use-deployments");
    const { result } = renderHook(() => useDeployments(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/dashboard/marketplace/deployments");
    expect(result.current.data?.deployments).toHaveLength(2);
  });

  it("useOrgDeploymentId returns the first deployment id as the anchor", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deployments: [{ id: "dep_1" }, { id: "dep_2" }] }),
    });
    const { useOrgDeploymentId } = await import("@/hooks/use-deployments");
    const { result } = renderHook(() => useOrgDeploymentId(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.deploymentId).toBe("dep_1"));
  });

  it("useOrgDeploymentId returns null when the org has no deployments", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ deployments: [] }) });
    const { useOrgDeploymentId } = await import("@/hooks/use-deployments");
    const { result } = renderHook(() => useOrgDeploymentId(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.deploymentId).toBeNull();
  });
});
```

- [ ] **Step 3: Run → fail.** `rm -rf apps/dashboard/.next && pnpm --filter @switchboard/dashboard test -- use-deployments` → FAIL (module not found).

- [ ] **Step 4: Implement** `use-deployments.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { MarketplaceDeployment } from "@/lib/api-client/marketplace-types";

async function fetchDeployments(): Promise<{ deployments: MarketplaceDeployment[] }> {
  const res = await fetch("/api/dashboard/marketplace/deployments");
  if (!res.ok) throw new Error("Failed to fetch deployments");
  return res.json();
}

export function useDeployments() {
  const keys = useScopedQueryKeys();
  return useQuery({
    queryKey: keys?.marketplace.deployments() ?? ["__disabled_deployments__"],
    queryFn: fetchDeployments,
    enabled: !!keys,
  });
}

/**
 * The org's deployment id used purely as the org-ownership ANCHOR for the
 * business-facts route. The route re-keys the write to the authenticated org,
 * so any of the org's deployment ids is correct; we take the first. Returns
 * null while loading or when the org has no deployments.
 */
export function useOrgDeploymentId(): {
  deploymentId: string | null;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useDeployments();
  return { deploymentId: data?.deployments?.[0]?.id ?? null, isLoading, isError };
}
```

- [ ] **Step 5: Run → pass.** Same command → PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/lib/query-keys.ts apps/dashboard/src/hooks/use-deployments.ts apps/dashboard/src/hooks/__tests__/use-deployments.test.ts
git commit -m "feat(dashboard): resolve org deployment id for business-facts anchor"
```

---

## Task 2: business-facts read + upsert hooks

**Files:**

- Create: `apps/dashboard/src/hooks/use-business-facts.ts`
- Test: `apps/dashboard/src/hooks/__tests__/use-business-facts.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { organizationId: "org-1" }, status: "authenticated" }),
}));
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useBusinessFacts / useUpsertBusinessFacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads {facts,status} from the proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ facts: { businessName: "Glow" }, status: "present" }),
    });
    const { useBusinessFacts } = await import("@/hooks/use-business-facts");
    const { result } = renderHook(() => useBusinessFacts("dep_1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/business-facts",
    );
    expect(result.current.data?.status).toBe("present");
  });

  it("is disabled (no fetch) when deploymentId is null", async () => {
    const { useBusinessFacts } = await import("@/hooks/use-business-facts");
    renderHook(() => useBusinessFacts(null), { wrapper: createWrapper() });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("PUTs facts and surfaces 400 details as BusinessFactsValidationError", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 400,
      ok: false,
      json: () => Promise.resolve({ error: "Validation failed", details: { fieldErrors: {} } }),
    });
    const { useUpsertBusinessFacts, BusinessFactsValidationError } =
      await import("@/hooks/use-business-facts");
    const { result } = renderHook(() => useUpsertBusinessFacts("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      result.current.mutate({ businessName: "X" } as never);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(BusinessFactsValidationError);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dashboard/marketplace/deployments/dep_1/business-facts",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("PUT success resolves", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) });
    const { useUpsertBusinessFacts } = await import("@/hooks/use-business-facts");
    const { result } = renderHook(() => useUpsertBusinessFacts("dep_1"), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      result.current.mutate({ businessName: "Glow" } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
```

- [ ] **Step 2: Run → fail.** `rm -rf apps/dashboard/.next && pnpm --filter @switchboard/dashboard test -- use-business-facts` → FAIL.

- [ ] **Step 3: Implement** `use-business-facts.ts`:

```ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScopedQueryKeys } from "@/hooks/use-query-keys";
import type { BusinessFacts } from "@switchboard/schemas";

export type BusinessFactsStatus = "present" | "missing" | "malformed";

export interface BusinessFactsResponse {
  facts: BusinessFacts | null;
  status: BusinessFactsStatus;
}

/** Thrown when the proxy rejects the payload (HTTP 400); carries the zod flatten() details. */
export class BusinessFactsValidationError extends Error {
  details: unknown;
  constructor(details: unknown) {
    super("Business facts validation failed");
    this.name = "BusinessFactsValidationError";
    this.details = details;
  }
}

async function fetchBusinessFacts(deploymentId: string): Promise<BusinessFactsResponse> {
  const res = await fetch(`/api/dashboard/marketplace/deployments/${deploymentId}/business-facts`);
  if (!res.ok) throw new Error("Failed to fetch business facts");
  return res.json();
}

export function useBusinessFacts(deploymentId: string | null) {
  const keys = useScopedQueryKeys();
  const enabled = !!keys && !!deploymentId;
  return useQuery({
    queryKey:
      keys && deploymentId
        ? keys.marketplace.businessFacts(deploymentId)
        : ["__disabled_business_facts__"],
    queryFn: () => fetchBusinessFacts(deploymentId as string),
    enabled,
  });
}

export function useUpsertBusinessFacts(deploymentId: string | null) {
  const queryClient = useQueryClient();
  const keys = useScopedQueryKeys();
  return useMutation({
    mutationFn: async (facts: BusinessFacts) => {
      const res = await fetch(
        `/api/dashboard/marketplace/deployments/${deploymentId}/business-facts`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(facts),
        },
      );
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        throw new BusinessFactsValidationError((body as { details?: unknown })?.details ?? body);
      }
      if (!res.ok) throw new Error("Failed to save business facts");
      return res.json();
    },
    onSuccess: () => {
      if (keys && deploymentId) {
        queryClient.invalidateQueries({ queryKey: keys.marketplace.businessFacts(deploymentId) });
        queryClient.invalidateQueries({ queryKey: keys.readiness.all() });
      }
    },
  });
}
```

- [ ] **Step 4: Run → pass.** PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/hooks/use-business-facts.ts apps/dashboard/src/hooks/__tests__/use-business-facts.test.ts
git commit -m "feat(dashboard): business-facts read + upsert hooks"
```

---

## Task 3: scaffold + serializer (pure form logic)

**Files:**

- Create: `apps/dashboard/src/components/settings/business-facts/scaffold.ts`
- Test: `apps/dashboard/src/components/settings/business-facts/__tests__/scaffold.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { WEEKDAYS, emptyBusinessFacts, serializeBusinessFacts } from "../scaffold";

describe("business-facts scaffold", () => {
  it("emptyBusinessFacts seeds 7 weekday rows, 1 location, 1 service, default tz", () => {
    const f = emptyBusinessFacts();
    expect(Object.keys(f.openingHours)).toEqual([...WEEKDAYS]);
    expect(f.locations).toHaveLength(1);
    expect(f.services).toHaveLength(1);
    expect(f.timezone).toBe("Asia/Singapore");
    expect(f.escalationContact.channel).toBe("whatsapp");
    expect(f.openingHours.sunday.closed).toBe(true);
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = emptyBusinessFacts();
    a.locations[0].name = "Mutated";
    expect(emptyBusinessFacts().locations[0].name).toBe("");
  });

  it("serializeBusinessFacts produces a schema-valid object and strips empty optionals", () => {
    const values = {
      ...emptyBusinessFacts(),
      businessName: "  Glow Aesthetics  ",
      locations: [
        { name: "Orchard", address: "391 Orchard Rd", parkingNotes: "", accessNotes: "" },
      ],
      services: [
        { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
      ],
      bookingPolicies: { advanceBookingDays: 60 },
      escalationContact: {
        name: "Front desk",
        channel: "whatsapp" as const,
        address: "+6560000000",
      },
    };
    const facts = serializeBusinessFacts(values);
    expect(BusinessFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts.businessName).toBe("Glow Aesthetics"); // trimmed
    expect(facts.locations[0].parkingNotes).toBeUndefined(); // empty optional stripped
    expect(facts.bookingPolicies?.advanceBookingDays).toBe(60);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `scaffold.ts`:

```ts
import { BusinessFactsSchema, type BusinessFacts } from "@switchboard/schemas";
import type { z } from "zod";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Form value type (pre-parse): all controlled fields present so inputs stay controlled. */
export type BusinessFactsForm = z.input<typeof BusinessFactsSchema>;

function defaultHours(): BusinessFactsForm["openingHours"] {
  const weekday = { open: "10:00", close: "20:00", closed: false };
  const weekend = { open: "10:00", close: "18:00", closed: false };
  return {
    monday: { ...weekday },
    tuesday: { ...weekday },
    wednesday: { ...weekday },
    thursday: { ...weekday },
    friday: { ...weekday },
    saturday: { ...weekend },
    sunday: { open: "10:00", close: "18:00", closed: true },
  };
}

export function emptyService(): NonNullable<BusinessFactsForm["services"]>[number] {
  return { name: "", description: "", price: "", currency: "SGD" };
}

export function emptyLocation(): BusinessFactsForm["locations"][number] {
  return { name: "", address: "", parkingNotes: "", accessNotes: "" };
}

export function emptyBusinessFacts(): BusinessFactsForm {
  return {
    businessName: "",
    timezone: "Asia/Singapore",
    locations: [emptyLocation()],
    openingHours: defaultHours(),
    services: [emptyService()],
    bookingPolicies: {},
    escalationContact: { name: "", channel: "whatsapp", address: "" },
    additionalFaqs: [],
  };
}

function clean(v: string | undefined | null): string | undefined {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
}

function cleanPolicies(p: BusinessFactsForm["bookingPolicies"]): BusinessFacts["bookingPolicies"] {
  if (!p) return undefined;
  const out = {
    cancellationPolicy: clean(p.cancellationPolicy),
    reschedulePolicy: clean(p.reschedulePolicy),
    noShowPolicy: clean(p.noShowPolicy),
    prepInstructions: clean(p.prepInstructions),
    advanceBookingDays: p.advanceBookingDays || undefined,
  };
  return Object.values(out).every((x) => x === undefined) ? undefined : out;
}

/**
 * Form values → canonical BusinessFacts. Trims, drops empty optionals, then
 * parses through the SAME BusinessFactsSchema the proxy/route enforce — so the
 * payload is guaranteed acceptable. The form's zodResolver has already validated
 * the required fields, so parse() will not throw in practice.
 */
export function serializeBusinessFacts(values: BusinessFactsForm): BusinessFacts {
  const cleaned = {
    businessName: values.businessName.trim(),
    timezone: clean(values.timezone) ?? "Asia/Singapore",
    locations: values.locations.map((l) => ({
      name: l.name.trim(),
      address: l.address.trim(),
      parkingNotes: clean(l.parkingNotes),
      accessNotes: clean(l.accessNotes),
    })),
    openingHours: values.openingHours,
    services: (values.services ?? []).map((s) => ({
      name: s.name.trim(),
      description: s.description.trim(),
      durationMinutes: s.durationMinutes || undefined,
      price: clean(s.price),
      currency: clean(s.currency) ?? "SGD",
      bookingBehavior: s.bookingBehavior || undefined,
      consultationRequired: s.consultationRequired || undefined,
      prepInstructions: clean(s.prepInstructions),
      aftercareNotes: clean(s.aftercareNotes),
      idealFor: clean(s.idealFor),
      notSuitableFor: clean(s.notSuitableFor),
      popularCombinations:
        (s.popularCombinations ?? []).map((x) => x.trim()).filter(Boolean).length > 0
          ? (s.popularCombinations ?? []).map((x) => x.trim()).filter(Boolean)
          : undefined,
    })),
    bookingPolicies: cleanPolicies(values.bookingPolicies),
    escalationContact: {
      name: values.escalationContact.name.trim(),
      channel: values.escalationContact.channel,
      address: values.escalationContact.address.trim(),
    },
    additionalFaqs: (values.additionalFaqs ?? [])
      .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
      .filter((f) => f.question !== "" && f.answer !== ""),
  };
  return BusinessFactsSchema.parse(cleaned);
}
```

- [ ] **Step 4: Run → pass.** (If `z.input` types fight the literals, adjust the helper return types — but keep the runtime behavior + assertions identical.)

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/settings/business-facts/scaffold.ts apps/dashboard/src/components/settings/business-facts/__tests__/scaffold.test.ts
git commit -m "feat(dashboard): business-facts form scaffold + serializer"
```

---

## Task 4: form section components

Build five presentational sections. Each receives RHF's `control`/`register`/`formState` (or is composed via the parent). Use `@/components/ui/*`: `Card/CardHeader/CardTitle/CardContent`, `Input`, `Label`, `Textarea`, `Button`, `Select` (+`SelectTrigger/SelectValue/SelectContent/SelectItem`), `Switch`. **Custom components (Select, Switch) require `Controller`** from `react-hook-form`; plain text/number Inputs and Textareas use `register`. Show/hide "advanced" blocks with `const [open, setOpen] = useState(false)` + `{open && (...)}` (codebase has no Collapsible component — mirror `components/settings/channel-management.tsx`). Errors render `<p className="text-xs text-destructive">{message}</p>` under the field (mirror `spend-limits-form.tsx`).

**Files (create):** `hours-section.tsx`, `locations-section.tsx`, `services-section.tsx`, `contact-policies-section.tsx`, `faqs-section.tsx` under `components/settings/business-facts/`.

### Section field specs

| Section                                          | Fields (required\*)                                                                                                                                                                                                                                                             | Component / wiring                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hours**                                        | per weekday in `WEEKDAYS`: `closed`, `open`, `close`                                                                                                                                                                                                                            | `Switch` via `Controller` for `openingHours.<day>.closed`; two `Input type="time"` (`register`) for `open`/`close`, **disabled when closed**.                  |
| **Locations** (`useFieldArray name="locations"`) | `name`\*, `address`\*; advanced: `parkingNotes`, `accessNotes`                                                                                                                                                                                                                  | `Input` (name), `Textarea` (address); advanced toggle → two `Textarea`. Add/remove row buttons (`append(emptyLocation())`, `remove(i)`); never remove below 1. |
| **Services** (`useFieldArray name="services"`)   | `name`\*, `description`\*, `price`, `currency`, `durationMinutes`; advanced: `bookingBehavior`(select), `consultationRequired`(switch), `prepInstructions`, `aftercareNotes`, `idealFor`, `notSuitableFor`                                                                      | `Input`/`Textarea` via `register`; `Select`+`Switch` via `Controller`; advanced toggle. Add/remove; never below 1.                                             |
| **Contact & policies**                           | `escalationContact.name`\*, `escalationContact.channel`\*(select whatsapp/telegram/email/sms), `escalationContact.address`\*; advanced collapsible booking policies: `cancellationPolicy`, `reschedulePolicy`, `noShowPolicy`, `prepInstructions`, `advanceBookingDays`(number) | `Input` + `Controller`-`Select` for channel; advanced `Textarea`s + number `Input`.                                                                            |
| **FAQs** (`useFieldArray name="additionalFaqs"`) | per row: `question`, `answer`                                                                                                                                                                                                                                                   | collapsible whole section; `Input`(question) + `Textarea`(answer); add/remove rows; may be empty.                                                              |

- [ ] **Step 1: Write the failing test** for the trickiest section, `hours-section.tsx` (`__tests__/hours-section.test.tsx`) — render inside a tiny RHF host and assert the closed toggle disables the time inputs:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { emptyBusinessFacts, type BusinessFactsForm } from "../scaffold";
import { HoursSection } from "../hours-section";

function Host() {
  const methods = useForm<BusinessFactsForm>({ defaultValues: emptyBusinessFacts() });
  return (
    <FormProvider {...methods}>
      <HoursSection control={methods.control} register={methods.register} />
    </FormProvider>
  );
}

describe("HoursSection", () => {
  it("renders a row per weekday and disables times when closed", () => {
    render(<Host />);
    // Sunday is closed by default in the scaffold → its time inputs are disabled
    const sundayOpen = screen.getByLabelText(/sunday open/i) as HTMLInputElement;
    expect(sundayOpen).toBeDisabled();
    const mondayOpen = screen.getByLabelText(/monday open/i) as HTMLInputElement;
    expect(mondayOpen).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `hours-section.tsx` (the canonical pattern the other sections follow):

```tsx
"use client";

import { Controller, type Control, type UseFormRegister } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WEEKDAYS, type BusinessFactsForm } from "./scaffold";

interface HoursSectionProps {
  control: Control<BusinessFactsForm>;
  register: UseFormRegister<BusinessFactsForm>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HoursSection({ control, register }: HoursSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Opening hours</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {WEEKDAYS.map((day) => (
          <Controller
            key={day}
            control={control}
            name={`openingHours.${day}.closed` as const}
            render={({ field: closedField }) => (
              <div className="flex items-center gap-3">
                <span className="w-24 text-sm">{cap(day)}</span>
                <Switch
                  checked={!closedField.value}
                  onCheckedChange={(open) => closedField.onChange(!open)}
                  aria-label={`${cap(day)} open`}
                />
                <Input
                  type="time"
                  aria-label={`${cap(day)} open`}
                  disabled={!!closedField.value}
                  className="w-32"
                  {...register(`openingHours.${day}.open` as const)}
                />
                <span className="text-muted-foreground">–</span>
                <Input
                  type="time"
                  aria-label={`${cap(day)} close`}
                  disabled={!!closedField.value}
                  className="w-32"
                  {...register(`openingHours.${day}.close` as const)}
                />
                {closedField.value && <span className="text-xs text-muted-foreground">Closed</span>}
              </div>
            )}
          />
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Implement the other four sections** following the same pattern (props: `control`, `register`, `formState`, and for field arrays the `useFieldArray` is owned by the **parent form** and passed `fields`/`append`/`remove` + the array `name` prefix; or each section calls `useFieldArray({ control, name })` itself — choose section-owned `useFieldArray` for encapsulation). Each is its own file, < 200 lines. Use the field specs table above. Reuse `emptyLocation()`/`emptyService()` for `append`. No new test required per section beyond the form integration test in Task 5, **except** add a 1-assertion render test for `services-section` and `locations-section` proving "Add" appends a row (mirror the Host pattern above).

- [ ] **Step 6: Commit.**

```bash
git add apps/dashboard/src/components/settings/business-facts/
git commit -m "feat(dashboard): business-facts form sections"
```

---

## Task 5: form orchestrator + integration test

**Files:**

- Create: `apps/dashboard/src/components/settings/business-facts/business-facts-form.tsx`
- Test: `apps/dashboard/src/components/settings/business-facts/__tests__/business-facts-form.test.tsx`

The orchestrator owns `useForm({ resolver: zodResolver(BusinessFactsSchema), defaultValues })`, composes the sections, renders the inline **Business** block (businessName `Input` + timezone `Input`), the sticky save `Button`, and a `malformed` caution banner. It is **presentational**: props `defaultValues: BusinessFactsForm`, `malformed?: boolean`, `isSaving?: boolean`, `onSubmit: (facts: BusinessFacts) => void`. On valid submit it calls `onSubmit(serializeBusinessFacts(values))`; on invalid submit RHF surfaces field errors and blocks.

- [ ] **Step 1: Write the failing test:**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { emptyBusinessFacts } from "../scaffold";
import { BusinessFactsForm } from "../business-facts-form";

describe("BusinessFactsForm", () => {
  it("blocks submit and shows an error when required fields are empty", async () => {
    const onSubmit = vi.fn();
    render(<BusinessFactsForm defaultValues={emptyBusinessFacts()} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /save business facts/i }));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());
    expect(screen.getAllByText(/required|expected|at least/i).length).toBeGreaterThan(0);
  });

  it("submits serialized facts when required fields are filled", async () => {
    const onSubmit = vi.fn();
    const defaults = {
      ...emptyBusinessFacts(),
      businessName: "Glow",
      locations: [
        { name: "Orchard", address: "391 Orchard Rd", parkingNotes: "", accessNotes: "" },
      ],
      services: [{ name: "Botox", description: "Anti-wrinkle", price: "$18", currency: "SGD" }],
      escalationContact: {
        name: "Front desk",
        channel: "whatsapp" as const,
        address: "+6560000000",
      },
    };
    render(<BusinessFactsForm defaultValues={defaults} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /save business facts/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].businessName).toBe("Glow");
  });

  it("shows the malformed banner when malformed", () => {
    render(<BusinessFactsForm defaultValues={emptyBusinessFacts()} malformed onSubmit={vi.fn()} />);
    expect(screen.getByText(/weren't loaded|re-enter/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `business-facts-form.tsx` (wire `useForm`, `FormProvider` or pass `control`/`register` to sections, `handleSubmit((v) => onSubmit(serializeBusinessFacts(v)))`, sticky `<Button type="submit" disabled={isSaving}>Save business facts</Button>`, malformed banner `<p>` in a `caution`-styled box). Keep < 250 lines; if larger, lift the Business block into its own small component.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit.**

```bash
git add apps/dashboard/src/components/settings/business-facts/business-facts-form.tsx apps/dashboard/src/components/settings/business-facts/__tests__/business-facts-form.test.tsx
git commit -m "feat(dashboard): business-facts form orchestrator"
```

---

## Task 6: settings page + states

**Files:**

- Create: `apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx`
- Test: `apps/dashboard/src/app/__tests__/settings-business-facts-page.test.tsx`

The page (a) resolves the deployment id (`useOrgDeploymentId`), (b) fetches facts (`useBusinessFacts`), (c) renders states: resolving/loading → `Skeleton` (gate on `!data && !error` of the facts query, plus deployment loading); zero-deployment → empty state; error → inline error; else → `<BusinessFactsForm>` with `defaultValues` = saved facts (when `status==="present"`) else `emptyBusinessFacts()`, `malformed={status==="malformed"}`, wired to `useUpsertBusinessFacts`. On save success → `toast({ title: "Business facts saved" })`; on `BusinessFactsValidationError` → `toast({ variant: "destructive", title: "Couldn't save", description: "Some fields are invalid" })`.

- [ ] **Step 1: Write the failing test** (mirror `app/__tests__/settings-knowledge-page.test.tsx`; `vi.mock` the three hooks + `use-toast`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useOrgDeploymentId = vi.fn();
const useBusinessFacts = vi.fn();
const useUpsertBusinessFacts = vi.fn();
vi.mock("@/hooks/use-deployments", () => ({ useOrgDeploymentId: () => useOrgDeploymentId() }));
vi.mock("@/hooks/use-business-facts", () => ({
  useBusinessFacts: () => useBusinessFacts(),
  useUpsertBusinessFacts: () => useUpsertBusinessFacts(),
  BusinessFactsValidationError: class extends Error {},
}));
vi.mock("@/components/ui/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import BusinessFactsPage from "@/app/(auth)/settings/business-facts/page";

describe("BusinessFactsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpsertBusinessFacts.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("shows an empty state when the org has no deployment", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: null, isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: undefined, error: null, isLoading: false });
    render(<BusinessFactsPage />);
    expect(screen.getByText(/deploy an agent first/i)).toBeInTheDocument();
  });

  it("renders the form when facts are missing (scaffold)", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: { facts: null, status: "missing" }, error: null });
    render(<BusinessFactsPage />);
    expect(screen.getByRole("button", { name: /save business facts/i })).toBeInTheDocument();
  });

  it("shows the malformed banner", () => {
    useOrgDeploymentId.mockReturnValue({ deploymentId: "dep_1", isLoading: false, isError: false });
    useBusinessFacts.mockReturnValue({ data: { facts: null, status: "malformed" }, error: null });
    render(<BusinessFactsPage />);
    expect(screen.getByText(/weren't loaded|re-enter/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `page.tsx` (`"use client"`; compose the hooks + `BusinessFactsForm`; `defaultValues = status==="present" && facts ? (facts as BusinessFactsForm) : emptyBusinessFacts()`). The settings sidebar/chrome comes from the existing `app/(auth)/settings/layout.tsx` (`SettingsLayout`), so the page renders only its content + an `<h1>` header consistent with other settings pages.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit.**

```bash
git add "apps/dashboard/src/app/(auth)/settings/business-facts/page.tsx" apps/dashboard/src/app/__tests__/settings-business-facts-page.test.tsx
git commit -m "feat(dashboard): business-facts settings page"
```

---

## Task 7: sidebar nav + go-live CTA + readiness comment

**Files:**

- Modify: `apps/dashboard/src/components/layout/settings-layout.tsx:5,10-18`
- Modify: `apps/dashboard/src/components/onboarding/go-live.tsx` (`AdvisoryCheckRow`, ~line 56)
- Modify: `apps/api/src/routes/readiness.ts:598-599`
- Test: extend `apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx`

- [ ] **Step 1: Add the sidebar item.** In `settings-layout.tsx`, import `ClipboardList` from `lucide-react` and add to `ALL_SIDEBAR_ITEMS` (place after Playbook):

```ts
  { href: "/settings/business-facts", label: "Business facts", icon: ClipboardList },
```

- [ ] **Step 2: Write the failing go-live test** asserting the advisory `business-facts-present` row renders a link to the editor when failing. Extend `go-live.test.tsx`: mock `useReadiness` to return a failing advisory check `{ id: "business-facts-present", label: "Business facts entered", blocking: false, status: "fail", message: "…" }` and assert `screen.getByRole("link", { name: /add business facts|business facts/i })` has `href="/settings/business-facts"`.

- [ ] **Step 3: Run → fail.**

- [ ] **Step 4: Implement the CTA** in `go-live.tsx`'s `AdvisoryCheckRow`: when `check.id === "business-facts-present" && check.status === "fail"`, render (below the message) `<Link href="/settings/business-facts" className="…">Add business facts →</Link>` (import `Link from "next/link"`).

- [ ] **Step 5: Refresh the readiness comment** in `readiness.ts` `checkBusinessFactsPresent` (replace the stale rationale):

```ts
// Advisory by design: the operator business-facts editor now exists
// (/settings/business-facts), but we keep this non-blocking until adoption is
// proven so a real org without facts is never hard-blocked at go-live.
const blocking = false;
```

- [ ] **Step 6: Run → pass.** `rm -rf apps/dashboard/.next && pnpm --filter @switchboard/dashboard test -- go-live`.

- [ ] **Step 7: Commit.**

```bash
git add apps/dashboard/src/components/layout/settings-layout.tsx apps/dashboard/src/components/onboarding/go-live.tsx apps/dashboard/src/components/onboarding/__tests__/go-live.test.tsx apps/api/src/routes/readiness.ts
git commit -m "feat(dashboard): surface business-facts editor in nav + go-live readiness"
```

---

## Task 8: production-path keystone test

**Files:**

- Create: `apps/dashboard/src/components/settings/business-facts/__tests__/business-facts-live-path.test.ts`

Proves the form's serialized output (a) passes `BusinessFactsSchema` and (b) reaches the **real** Alex prompt through the **real** `alexBuilder` + `PrismaBusinessFactsStore` (mirrors `apps/api/src/__tests__/alex-business-facts-live-path.test.ts`, but with **this slice's serializer** as the input — the new seam).

- [ ] **Step 1: Write the test:**

```ts
import { describe, it, expect, vi } from "vitest";
import { alexBuilder } from "@switchboard/core";
import { PrismaBusinessFactsStore } from "@switchboard/db";
import { BusinessFactsSchema } from "@switchboard/schemas";
import { emptyBusinessFacts, serializeBusinessFacts } from "../scaffold";

function storeOver(config: unknown) {
  const prisma = {
    businessConfig: {
      findUnique: vi.fn().mockResolvedValue(config ? { organizationId: "org_1", config } : null),
    },
  };
  return new PrismaBusinessFactsStore(prisma as never);
}

const ctx = {
  persona: {
    businessName: "Glow Aesthetics",
    tone: "friendly",
    qualificationCriteria: {},
    disqualificationCriteria: {},
    escalationRules: {},
    bookingLink: "",
    customInstructions: "",
  },
} as never;
const baseStores = {
  opportunityStore: {
    findActiveByContact: vi
      .fn()
      .mockResolvedValue([{ id: "opp_1", stage: "interested", createdAt: new Date() }]),
  },
  contactStore: { findById: vi.fn().mockResolvedValue({ name: "Sarah", source: "whatsapp" }) },
};
const config = { deploymentId: "dep_1", orgId: "org_1", contactId: "contact_1" };

describe("business-facts editor — production-path keystone", () => {
  it("form output is schema-valid and reaches BUSINESS_FACTS via the real builder", async () => {
    const filled = {
      ...emptyBusinessFacts(),
      businessName: "Glow Aesthetics",
      locations: [
        { name: "Orchard", address: "391 Orchard Rd", parkingNotes: "", accessNotes: "" },
      ],
      openingHours: {
        ...emptyBusinessFacts().openingHours,
        monday: { open: "10:00", close: "20:00", closed: false },
      },
      services: [
        { name: "Botox", description: "Anti-wrinkle", price: "from $18/unit", currency: "SGD" },
      ],
      bookingPolicies: { advanceBookingDays: 60 },
      escalationContact: {
        name: "Front desk",
        channel: "whatsapp" as const,
        address: "+6560000000",
      },
      additionalFaqs: [],
    };
    const facts = serializeBusinessFacts(filled);
    expect(BusinessFactsSchema.safeParse(facts).success).toBe(true);

    const stores = { ...baseStores, businessFactsStore: storeOver(facts) };
    const result = await alexBuilder(ctx, config, stores as never);
    const bf = result.parameters.BUSINESS_FACTS as string;
    expect(bf).toContain("10:00");
    expect(bf).toContain("from $18/unit");
    expect(bf).toContain("Advance booking: up to 60 days ahead (subject to availability)");
  });
});
```

- [ ] **Step 2: Run → pass** (it should pass immediately — the serializer + builder already exist): `rm -rf apps/dashboard/.next && pnpm --filter @switchboard/dashboard test -- business-facts-live-path`. If `alexBuilder` needs a built `@switchboard/core`/`@switchboard/db`, run `pnpm --filter @switchboard/core --filter @switchboard/db build` first.

- [ ] **Step 3: Commit.**

```bash
git add apps/dashboard/src/components/settings/business-facts/__tests__/business-facts-live-path.test.ts
git commit -m "test(dashboard): business-facts editor production-path keystone"
```

---

## Task 9: full verification gate

- [ ] **Step 1: Clean + dashboard build** (catches `.js`-less import mistakes):

```bash
rm -rf apps/dashboard/.next
pnpm --filter @switchboard/dashboard build
```

Expected: build succeeds, `/settings/business-facts` listed in the route table.

- [ ] **Step 2: Full gates from repo root:**

```bash
pnpm typecheck
pnpm --filter @switchboard/dashboard test
pnpm lint
pnpm format:check
pnpm build
```

Expected: all green; dashboard coverage ≥ 40/35/40/40.

- [ ] **Step 3: Confirm no backend behavior change** (only a comment in readiness):

```bash
git diff origin/main --stat -- apps/api packages/
git diff origin/main -- apps/api/src/routes/readiness.ts   # comment-only
rg "inputConfig.*businessFacts" apps/dashboard/src || echo "no legacy inputConfig writes (good)"
```

- [ ] **Step 4: Final commit** (only if any fixup was needed; otherwise skip).

---

## Self-Review (completed by author)

- **Spec coverage:** Surface (Task 6 page + Task 7 nav) ✓; form fidelity core+advanced (Task 4/5) ✓; readiness non-blocking + CTA (Task 7) ✓; scaffold/load-existing/malformed (Task 3/5/6) ✓; deploymentId anchor (Task 1) ✓; production-path proof (Task 8) ✓; consumes #813 proxy, no new route (Tasks 2/6) ✓; gates (Task 9) ✓.
- **Placeholders:** none — code shown for every logic-bearing step; presentational JSX governed by the field-spec table + the worked Hours section.
- **Type consistency:** `BusinessFactsForm` (= `z.input<…>`), `serializeBusinessFacts(values): BusinessFacts`, `useOrgDeploymentId(): {deploymentId,…}`, `useUpsertBusinessFacts(deploymentId).mutate(facts: BusinessFacts)`, `BusinessFactsValidationError` used consistently across Tasks 1–8.
