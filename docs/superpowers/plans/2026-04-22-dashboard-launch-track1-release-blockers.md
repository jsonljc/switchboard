# Dashboard Launch Track 1: Release Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a shippable dashboard baseline by fixing build/package drift, closing auth/security gaps, removing phantom API surfaces, and establishing a reliable release verification gate.

**Architecture:** This track hardens the dashboard from the bottom up. First, make the shared workspace packages and generated Prisma client match the source that the dashboard expects. Then centralize auth gating, remove the public dev bypass, and enforce server-side protection in both middleware and route handlers. Finish by deleting dead API callers and locking the release gate to real verification commands.

**Tech Stack:** Next.js 15, React 19, NextAuth v5 beta, Prisma, pnpm workspaces, Turbo, TypeScript, Vitest

---

## File Map

- Modify: `apps/dashboard/next.config.mjs`
- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/src/app/(auth)/layout.tsx`
- Modify: `apps/dashboard/src/lib/auth.ts`
- Modify: `apps/dashboard/src/lib/get-api-client.ts`
- Modify: `apps/dashboard/src/lib/session.ts`
- Modify: `apps/dashboard/src/lib/api-client/settings.ts`
- Modify: `apps/dashboard/src/middleware.ts`
- Modify: `apps/dashboard/src/providers/auth-provider.tsx`
- Modify: `apps/dashboard/src/app/api/dashboard/approvals/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/audit/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/estimate/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/approve/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/reject/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/traces/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/progression/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/onboard/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/persona/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/review/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/submit/route.ts`
- Modify: `package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/schemas/package.json`
- Create: `apps/dashboard/src/lib/dev-auth.ts`
- Create: `apps/dashboard/src/lib/require-dashboard-session.ts`
- Create: `packages/schemas/src/__tests__/index-exports.test.ts`
- Create: `packages/db/src/__tests__/dashboard-client-surface.test.ts`

---

## Task 1: Restore Workspace Package And Prisma Parity

**Files:**

- Modify: `package.json`
- Modify: `apps/dashboard/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/schemas/package.json`
- Create: `packages/schemas/src/__tests__/index-exports.test.ts`
- Create: `packages/db/src/__tests__/dashboard-client-surface.test.ts`

- [ ] **Step 1: Write the failing contract tests**

```typescript
// packages/schemas/src/__tests__/index-exports.test.ts
import { describe, expect, it } from "vitest";
import * as schemas from "../index.js";

describe("schemas index exports", () => {
  it("exports dashboard onboarding primitives", () => {
    expect(typeof schemas.createEmptyPlaybook).toBe("function");
    expect(schemas.PlaybookSchema).toBeDefined();
    expect(schemas.BusinessFactsSchema).toBeDefined();
    expect(schemas.ScanResultSchema).toBeDefined();
    expect(schemas.DashboardOverviewSchema).toBeDefined();
  });
});
```

```typescript
// packages/db/src/__tests__/dashboard-client-surface.test.ts
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

describe("generated Prisma client surface", () => {
  it("includes dashboard and marketplace fields used by the dashboard app", () => {
    const client = new PrismaClient();
    expect("dashboardUser" in client).toBe(true);
  });
});
```

- [ ] **Step 2: Run the current failing verification**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: FAIL with missing exports like `createEmptyPlaybook`, `BusinessFactsSchema`, `DashboardOverview`, and missing Prisma fields like `googleId`

- [ ] **Step 3: Make package builds self-healing**

```json
// packages/db/package.json
{
  "scripts": {
    "build": "pnpm run generate && tsc",
    "generate": "prisma generate"
  }
}
```

```json
// package.json
{
  "scripts": {
    "dashboard:preflight": "pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/db build && pnpm --filter @switchboard/dashboard typecheck"
  }
}
```

```json
// apps/dashboard/package.json
{
  "scripts": {
    "typecheck": "pnpm --filter @switchboard/schemas build && pnpm --filter @switchboard/db build && tsc --noEmit"
  }
}
```

- [ ] **Step 4: Rebuild and verify the package contract**

Run:

```bash
pnpm --filter @switchboard/schemas build
pnpm --filter @switchboard/db build
pnpm --filter @switchboard/schemas test -- src/__tests__/index-exports.test.ts
pnpm --filter @switchboard/dashboard typecheck
```

Expected:

- `packages/schemas/dist/index.js` exports onboarding/playbook symbols
- generated Prisma client recognizes `googleId` and the marketplace models used by the dashboard
- dashboard typecheck no longer fails on stale workspace artifacts

- [ ] **Step 5: Commit**

```bash
git add package.json apps/dashboard/package.json packages/db/package.json packages/schemas/package.json packages/schemas/src/__tests__/index-exports.test.ts packages/db/src/__tests__/dashboard-client-surface.test.ts
git commit -m "build: restore dashboard workspace contract"
```

---

## Task 2: Remove The Public Dev Bypass And Add Production Auth Guards

**Files:**

- Create: `apps/dashboard/src/lib/dev-auth.ts`
- Modify: `apps/dashboard/src/app/(auth)/layout.tsx`
- Modify: `apps/dashboard/src/lib/auth.ts`
- Modify: `apps/dashboard/src/lib/get-api-client.ts`
- Modify: `apps/dashboard/src/lib/session.ts`
- Modify: `apps/dashboard/src/providers/auth-provider.tsx`

- [ ] **Step 1: Write the failing auth guard tests**

```typescript
// apps/dashboard/src/lib/dev-auth.ts
export function assertSafeDashboardAuthEnv() {
  if (process.env.NODE_ENV === "production" && process.env.DEV_BYPASS_AUTH === "true") {
    throw new Error("DEV_BYPASS_AUTH must never be enabled in production");
  }
  if (process.env.NODE_ENV === "production" && !process.env.NEXTAUTH_SECRET) {
    throw new Error("NEXTAUTH_SECRET is required in production");
  }
}
```

- [ ] **Step 2: Confirm the current unsafe behavior**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: current code still references `NEXT_PUBLIC_DEV_BYPASS_AUTH` in browser and server paths, and there is no production assertion for `NEXTAUTH_SECRET`

- [ ] **Step 3: Move bypass control to server-only env and pass the mock session from the auth layout**

```tsx
// apps/dashboard/src/app/(auth)/layout.tsx
import { getServerSession } from "@/lib/session";
import { AuthProvider } from "@/providers/auth-provider";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  return <AuthProvider session={session}>{children}</AuthProvider>;
}
```

```tsx
// apps/dashboard/src/providers/auth-provider.tsx
"use client";

import { SessionProvider } from "next-auth/react";
import type { DashboardSession } from "@/lib/session";

export function AuthProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: DashboardSession | null;
}) {
  return <SessionProvider session={session as any}>{children}</SessionProvider>;
}
```

```typescript
// apps/dashboard/src/lib/session.ts
import "server-only";
import { auth } from "./auth";
import { assertSafeDashboardAuthEnv, getDevDashboardSession } from "./dev-auth";
```

- [ ] **Step 4: Gate production at startup**

```typescript
// apps/dashboard/src/lib/auth.ts
import { assertSafeDashboardAuthEnv } from "./dev-auth";

assertSafeDashboardAuthEnv();
```

```typescript
// apps/dashboard/src/lib/get-api-client.ts
if (process.env.NODE_ENV !== "production" && process.env.DEV_BYPASS_AUTH === "true") {
  // dev-only fallback branch
}
```

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @switchboard/dashboard typecheck
pnpm --filter @switchboard/dashboard test -- src/lib/__tests__/session.test.ts
```

Expected:

- no `NEXT_PUBLIC_DEV_BYPASS_AUTH` references remain
- dev bypass is only available via server-side env
- production boot fails fast if `NEXTAUTH_SECRET` is missing or bypass is enabled

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/dev-auth.ts apps/dashboard/src/app/(auth)/layout.tsx apps/dashboard/src/providers/auth-provider.tsx apps/dashboard/src/lib/session.ts apps/dashboard/src/lib/get-api-client.ts apps/dashboard/src/lib/auth.ts
git commit -m "auth: harden dashboard session configuration"
```

---

## Task 3: Enforce Server-Side Protection In Middleware And API Routes

**Files:**

- Create: `apps/dashboard/src/lib/require-dashboard-session.ts`
- Modify: `apps/dashboard/src/middleware.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/approvals/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/audit/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/approve/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/creative-jobs/[id]/estimate/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/business-facts/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/approve/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/faq-drafts/[faqId]/reject/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/deployments/[id]/traces/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/deploy/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/listings/[id]/trust/progression/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/onboard/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/persona/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/review/route.ts`
- Modify: `apps/dashboard/src/app/api/dashboard/marketplace/tasks/[id]/submit/route.ts`

- [ ] **Step 1: Add a single helper that must run before any dashboard API work**

```typescript
// apps/dashboard/src/lib/require-dashboard-session.ts
import { requireSession } from "@/lib/session";

export async function requireDashboardSession() {
  return requireSession();
}
```

- [ ] **Step 2: Make the 22 currently unguarded routes fail closed before client construction**

```typescript
// apps/dashboard/src/app/api/dashboard/marketplace/onboard/route.ts
import { requireDashboardSession } from "@/lib/require-dashboard-session";

export async function POST(request: NextRequest) {
  try {
    await requireDashboardSession();
    const client = await getApiClient();
    const body = await request.json();
    const data = await client.onboard(body);
    return NextResponse.json(data, { status: 201 });
  } catch (err: unknown) {
    return proxyError(
      err instanceof Error ? { error: err.message } : {},
      err instanceof Error && err.message === "Unauthorized" ? 401 : 500,
    );
  }
}
```

- [ ] **Step 3: Protect `(auth)` page routes in middleware while leaving public pages and health checks open**

```typescript
// apps/dashboard/src/middleware.ts
const PUBLIC_PATHS = ["/", "/pricing", "/how-it-works", "/agents", "/get-started", "/login"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/dashboard/health")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/dashboard")) {
    // existing rate limiting
  }

  const isAuthPage =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/marketplace") ||
    pathname.startsWith("/deploy") ||
    pathname.startsWith("/deployments") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/decide") ||
    pathname.startsWith("/me") ||
    pathname.startsWith("/my-agent") ||
    pathname.startsWith("/tasks");

  if (isAuthPage) {
    const sessionToken =
      request.cookies.get("__Secure-authjs.session-token")?.value ??
      request.cookies.get("authjs.session-token")?.value;
    if (!sessionToken) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}
```

- [ ] **Step 4: Verify the route inventory**

Run:

```bash
find apps/dashboard/src/app/api/dashboard -type f -name 'route.ts' | while read -r f; do
  if ! rg -q 'requireSession\\(|requireDashboardSession\\(' "$f"; then
    if [ "$f" != "apps/dashboard/src/app/api/dashboard/health/route.ts" ]; then
      echo "$f"
    fi
  fi
done
```

Expected: no output

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/lib/require-dashboard-session.ts apps/dashboard/src/middleware.ts apps/dashboard/src/app/api/dashboard
git commit -m "auth: enforce dashboard route protection"
```

---

## Task 4: Add Security Headers And Delete Dead API Surface

**Files:**

- Modify: `apps/dashboard/next.config.mjs`
- Modify: `apps/dashboard/src/lib/api-client/settings.ts`
- Modify: `apps/dashboard/src/lib/get-api-client.ts`

- [ ] **Step 1: Add the missing response headers**

```javascript
// apps/dashboard/next.config.mjs
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:;",
  },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
```

- [ ] **Step 2: Remove or quarantine dead settings client methods that call endpoints the backend does not expose**

```typescript
// apps/dashboard/src/lib/api-client/settings.ts
// Remove:
// - listCartridges()
// - getIntegrationGuide()
// - triggerHandoff()
//
// If one is still required by UI code, replace it with a typed "not yet supported"
// method that throws immediately instead of 404ing in production.
```

- [ ] **Step 3: Make backend URL fallback safe**

```typescript
// apps/dashboard/src/lib/get-api-client.ts
const baseUrl = process.env.SWITCHBOARD_API_URL;
if (!baseUrl) {
  throw new Error("SWITCHBOARD_API_URL is required");
}
```

- [ ] **Step 4: Verify**

Run:

```bash
rg -n 'NEXT_PUBLIC_DEV_BYPASS_AUTH|http://localhost:3000|/api/cartridges|/integration\\?|/handoff' apps/dashboard/src
pnpm --filter @switchboard/dashboard build
```

Expected:

- no production dashboard code references the public dev bypass
- no dashboard settings client points at nonexistent backend routes
- dashboard build succeeds with headers enabled

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/next.config.mjs apps/dashboard/src/lib/api-client/settings.ts apps/dashboard/src/lib/get-api-client.ts
git commit -m "security: add headers and remove dead dashboard api surface"
```

---

## Task 5: Establish The Release Gate

**Files:**

- Modify: `docs/DEPLOYMENT-CHECKLIST.md`
- Modify: `package.json`

- [ ] **Step 1: Add a single release command**

```json
// package.json
{
  "scripts": {
    "dashboard:release-check": "pnpm dashboard:preflight && pnpm --filter @switchboard/dashboard test && pnpm --filter @switchboard/dashboard build"
  }
}
```

- [ ] **Step 2: Document the exact launch gate**

````markdown
<!-- docs/DEPLOYMENT-CHECKLIST.md -->

## Dashboard Release Gate

Run these commands before launch:

```bash
pnpm dashboard:preflight
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard build
```

Do not launch if any of the three commands fail.
````

- [ ] **Step 3: Run the gate**

Run:

```bash
pnpm dashboard:release-check
```

Expected: all commands exit `0`

- [ ] **Step 4: Commit**

```bash
git add package.json docs/DEPLOYMENT-CHECKLIST.md
git commit -m "docs: codify dashboard release gate"
```
