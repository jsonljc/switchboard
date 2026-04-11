# SP4: Agent Storefront — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public micro-landing page at `/agent/[slug]` that shows a business's profile (from website scan) with an embedded chat widget, auto-generated from the onboarding flow.

**Architecture:** New API route to fetch deployment by slug (public, no auth). New Next.js server-rendered page in `(public)/agent/[slug]/` that fetches deployment data and renders business info + embedded widget. The widget connects cross-origin to the chat server's existing SSE endpoints.

**Tech Stack:** Next.js 14 (server components), Tailwind, Fastify

---

## File Structure

| Action | Path                                                            | Responsibility                                             |
| ------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Create | `apps/api/src/routes/storefront.ts`                             | `GET /storefront/:slug` — public deployment lookup by slug |
| Modify | `apps/api/src/bootstrap/routes.ts`                              | Register storefront route                                  |
| Create | `apps/dashboard/src/app/(public)/agent/[slug]/page.tsx`         | Server-rendered storefront page                            |
| Create | `apps/dashboard/src/components/marketplace/storefront-page.tsx` | Client component with widget embed                         |

---

### Task 1: Storefront API Route

**Files:**

- Create: `apps/api/src/routes/storefront.ts`
- Modify: `apps/api/src/bootstrap/routes.ts`

- [ ] **Step 1: Create the storefront route**

Create `apps/api/src/routes/storefront.ts`:

```typescript
import type { FastifyPluginAsync } from "fastify";

export const storefrontRoutes: FastifyPluginAsync = async (app) => {
  // Public — no auth required
  app.get<{ Params: { slug: string } }>("/:slug", async (request, reply) => {
    const { slug } = request.params;

    const deployment = await app.prisma.agentDeployment.findUnique({
      where: { slug },
      include: { listing: true },
    });

    if (!deployment || deployment.status === "inactive") {
      return reply.code(404).send({ error: "Agent not found" });
    }

    const inputConfig = deployment.inputConfig as Record<string, unknown>;
    const scannedProfile = (inputConfig.scannedProfile as Record<string, unknown>) ?? null;

    // Find widget token for this deployment
    const widgetConnection = await app.prisma.deploymentConnection.findFirst({
      where: {
        deploymentId: deployment.id,
        type: "web_widget",
        status: "active",
      },
    });

    return reply.send({
      slug: deployment.slug,
      businessName: (inputConfig.businessName as string) ?? deployment.listing.name,
      agentName: deployment.listing.name,
      scannedProfile,
      widgetToken: widgetConnection ? "present" : null,
      listingSlug: deployment.listing.slug,
    });
  });
};
```

Note: We return `widgetToken: "present"` (not the actual token) since the storefront page will construct the widget URL using the deployment's connection token from a separate query. Actually — the storefront page needs the real token to embed the widget. The token is in the encrypted credentials. Let's return it by decrypting:

```typescript
import { decryptCredentials } from "@switchboard/db";

// After finding widgetConnection:
let widgetToken: string | null = null;
if (widgetConnection) {
  const creds = decryptCredentials(widgetConnection.credentials) as Record<string, unknown>;
  widgetToken = (creds.token as string) ?? null;
}

return reply.send({
  slug: deployment.slug,
  businessName: (inputConfig.businessName as string) ?? deployment.listing.name,
  agentName: deployment.listing.name,
  scannedProfile,
  widgetToken,
  listingSlug: deployment.listing.slug,
});
```

- [ ] **Step 2: Register the route**

In `apps/api/src/bootstrap/routes.ts`, add:

```typescript
import { storefrontRoutes } from "../routes/storefront.js";

// In registerRoutes():
await app.register(storefrontRoutes, { prefix: "/api/storefront" });
```

- [ ] **Step 3: Verify**

Run: `npx pnpm@9.15.4 --filter api typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/api/ && git commit -m "feat(api): add public storefront route GET /api/storefront/:slug"
```

---

### Task 2: Dashboard Proxy Route for Storefront

**Files:**

- Create: `apps/dashboard/src/app/api/dashboard/storefront/[slug]/route.ts`

- [ ] **Step 1: Read existing proxy pattern**

Read `apps/dashboard/src/lib/api-client.ts` to understand the fetch pattern, then read an existing proxy route.

- [ ] **Step 2: Create the proxy route**

Create `apps/dashboard/src/app/api/dashboard/storefront/[slug]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const res = await fetch(`${API_BASE}/api/storefront/${slug}`);
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

Note: Read the existing proxy routes to confirm whether `params` is a Promise (Next.js 15 pattern) or direct object (Next.js 14). Follow whichever pattern the codebase uses.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/api/ && git commit -m "feat(dashboard): add storefront proxy route"
```

---

### Task 3: Storefront Page

**Files:**

- Create: `apps/dashboard/src/app/(public)/agent/[slug]/page.tsx`
- Create: `apps/dashboard/src/components/marketplace/storefront-page.tsx`

- [ ] **Step 1: Create the server page**

Create `apps/dashboard/src/app/(public)/agent/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StorefrontPage } from "@/components/marketplace/storefront-page";

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

interface StorefrontData {
  slug: string;
  businessName: string;
  agentName: string;
  scannedProfile: Record<string, unknown> | null;
  widgetToken: string | null;
  listingSlug: string;
}

async function getStorefront(slug: string): Promise<StorefrontData | null> {
  try {
    const res = await fetch(`${API_BASE}/api/storefront/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getStorefront(slug);
  return {
    title: data ? `${data.businessName} — Powered by Switchboard` : "Agent Not Found",
    description: data ? `Chat with ${data.businessName}'s AI assistant` : undefined,
  };
}

export default async function AgentStorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getStorefront(slug);
  if (!data) notFound();

  return <StorefrontPage data={data} />;
}
```

- [ ] **Step 2: Create the client component**

Create `apps/dashboard/src/components/marketplace/storefront-page.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";

interface ScannedProfile {
  businessName?: string;
  description?: string;
  products?: Array<{ name: string; description: string; price?: string }>;
  services?: string[];
  location?: { address: string; city: string; state: string };
  hours?: Record<string, string>;
  phone?: string;
  email?: string;
}

interface StorefrontData {
  slug: string;
  businessName: string;
  agentName: string;
  scannedProfile: ScannedProfile | null;
  widgetToken: string | null;
  listingSlug: string;
}

const CHAT_SERVER_URL = process.env.NEXT_PUBLIC_CHAT_SERVER_URL || "http://localhost:3001";

export function StorefrontPage({ data }: { data: StorefrontData }) {
  const profile = data.scannedProfile;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{data.businessName}</h1>
          {profile?.description && (
            <p className="mt-2 text-lg text-muted-foreground">{profile.description}</p>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_400px]">
          {/* Left: Business Info */}
          <div className="space-y-6">
            {profile?.services && profile.services.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                  Services
                </h2>
                <div className="flex flex-wrap gap-2">
                  {profile.services.map((s, i) => (
                    <Badge key={i} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {profile?.products && profile.products.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                  Products
                </h2>
                <div className="space-y-2">
                  {profile.products.map((p, i) => (
                    <div key={i} className="flex items-baseline justify-between">
                      <span className="font-medium">{p.name}</span>
                      {p.price && <span className="text-sm text-muted-foreground">{p.price}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(profile?.location || profile?.phone || profile?.email) && (
              <div>
                <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                  Contact
                </h2>
                <div className="space-y-1 text-sm">
                  {profile.location && (
                    <p>
                      {profile.location.address}, {profile.location.city}, {profile.location.state}
                    </p>
                  )}
                  {profile.phone && <p>{profile.phone}</p>}
                  {profile.email && <p>{profile.email}</p>}
                </div>
              </div>
            )}

            {profile?.hours && Object.keys(profile.hours).length > 0 && (
              <div>
                <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
                  Hours
                </h2>
                <div className="space-y-1 text-sm">
                  {Object.entries(profile.hours).map(([day, hours]) => (
                    <div key={day} className="flex justify-between">
                      <span className="capitalize">{day}</span>
                      <span className="text-muted-foreground">{hours}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Chat Widget */}
          <div className="lg:sticky lg:top-8 h-fit">
            {data.widgetToken ? (
              <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <div className="p-3 border-b bg-muted/50">
                  <p className="text-sm font-medium">Chat with {data.businessName}</p>
                </div>
                <iframe
                  src={`${CHAT_SERVER_URL}/widget/${data.widgetToken}/embed`}
                  className="w-full h-[500px] border-0"
                  title={`Chat with ${data.businessName}`}
                  allow="microphone"
                />
              </div>
            ) : (
              <div className="rounded-xl border bg-muted/30 p-8 text-center">
                <p className="text-sm text-muted-foreground">Chat coming soon</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t text-center">
          <p className="text-xs text-muted-foreground">
            Powered by{" "}
            <a href="/" className="underline hover:text-foreground">
              Switchboard
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/ && git commit -m "feat(dashboard): add public agent storefront page"
```

---

## Verification Checklist

1. `npx pnpm@9.15.4 --filter api typecheck` — no errors
2. `npx pnpm@9.15.4 --filter dashboard typecheck` — no errors
3. `/agent/austin-bakery` renders business info from deployment's `inputConfig.scannedProfile`
4. Widget iframe embeds when `widgetToken` is present
5. 404 returned for non-existent slugs
