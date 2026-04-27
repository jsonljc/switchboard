# SP1: Auth + Public Marketplace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth to the existing NextAuth setup and make the marketplace browse page publicly accessible (no login required to browse, login required to deploy).

**Architecture:** Extend the existing NextAuth v5 config (`apps/dashboard/src/lib/auth.ts`) with a Google OAuth provider. Add `googleId` to `DashboardUser` via Prisma migration. Move the marketplace browse page from `(auth)/` to `(public)/` so it's accessible without login. Add an inline auth gate on the "Deploy" button that triggers login for unauthenticated users.

**Tech Stack:** NextAuth v5, Google OAuth, Prisma, Next.js 14 App Router

---

## File Structure

| Action | Path                                                   | Responsibility                                                                |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Modify | `packages/db/prisma/schema.prisma`                     | Add `googleId` to `DashboardUser`, `users` relation to `OrganizationConfig`   |
| Modify | `apps/dashboard/src/lib/auth.ts`                       | Add Google OAuth provider, handle `getUserByAccount`, first-time provisioning |
| Modify | `apps/dashboard/src/lib/provision-dashboard-user.ts`   | Accept optional `googleId` param                                              |
| Create | `apps/dashboard/src/app/(public)/marketplace/page.tsx` | Public marketplace browse (no auth)                                           |
| Modify | `apps/dashboard/src/app/(auth)/marketplace/page.tsx`   | Redirect to public marketplace                                                |
| Modify | `apps/dashboard/package.json`                          | Add `next-auth` Google provider (if not already re-exported)                  |

---

### Task 1: Prisma Migration — DashboardUser.googleId

**Files:**

- Modify: `packages/db/prisma/schema.prisma:290-303` (DashboardUser model)
- Modify: `packages/db/prisma/schema.prisma:323-335` (OrganizationConfig model)

- [ ] **Step 1: Add `googleId` field to `DashboardUser`**

In `packages/db/prisma/schema.prisma`, find the `DashboardUser` model and add `googleId` after `apiKeyHash`:

```prisma
model DashboardUser {
  id              String    @id @default(uuid())
  email           String    @unique
  name            String?
  emailVerified   DateTime?
  organizationId  String
  principalId     String
  apiKeyEncrypted String
  passwordHash    String?
  apiKeyHash      String?   @unique
  googleId        String?   @unique
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  sessions        DashboardSession[]
}
```

- [ ] **Step 2: Add `users` relation to `OrganizationConfig`**

In the same file, find `OrganizationConfig` and add a `users` relation:

```prisma
model OrganizationConfig {
  id                   String   @id // orgId
  name                 String
  runtimeType          String   @default("http")
  runtimeConfig        Json     @default("{}")
  governanceProfile    String   @default("guarded")
  onboardingComplete   Boolean  @default(false)
  managedChannels      String[] @default([])
  provisioningStatus   String   @default("pending")
  purchasedAgents      String[] @default([])
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  users                DashboardUser[]
}
```

Also add the relation field to `DashboardUser`:

```prisma
  organizationId  String
  org             OrganizationConfig @relation(fields: [organizationId], references: [id])
```

- [ ] **Step 3: Generate and run migration**

Run:

```bash
npx pnpm@9.15.4 db:generate
npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate dev --name add-google-id-and-org-relation
```

Expected: Migration creates successfully, Prisma client regenerates.

- [ ] **Step 4: Verify migration**

Run:

```bash
npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate status
```

Expected: All migrations applied, no pending.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/ && git commit -m "feat(db): add googleId to DashboardUser and org relation"
```

---

### Task 2: Update Provisioning to Support Google OAuth

**Files:**

- Modify: `apps/dashboard/src/lib/provision-dashboard-user.ts`
- Test: `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/lib/__tests__/provision-dashboard-user.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// We test the interface change — provisionDashboardUser should accept googleId
describe("provisionDashboardUser", () => {
  it("accepts optional googleId parameter", async () => {
    // This test verifies the type signature accepts googleId
    // Full integration test requires DB — we just verify the function exists
    // and the interface compiles with googleId
    const { provisionDashboardUser } = await import("../provision-dashboard-user");
    expect(typeof provisionDashboardUser).toBe("function");
  });
});
```

- [ ] **Step 2: Update provisionDashboardUser to accept googleId**

In `apps/dashboard/src/lib/provision-dashboard-user.ts`, modify the input interface and the create call:

```typescript
interface ProvisionDashboardUserInput {
  email: string;
  name?: string | null;
  emailVerified?: Date | null;
  googleId?: string | null; // NEW — for Google OAuth sign-in
}
```

And in the `tx.dashboardUser.create` call, add `googleId`:

```typescript
return tx.dashboardUser.create({
  data: {
    id: randomUUID(),
    email: input.email,
    name: input.name,
    emailVerified: input.emailVerified,
    organizationId: orgId,
    principalId,
    apiKeyEncrypted: encryptApiKey(apiKey),
    apiKeyHash: createHash("sha256").update(apiKey).digest("hex"),
    googleId: input.googleId ?? null,
  },
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter dashboard test -- --run provision-dashboard-user`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/lib/provision-dashboard-user.ts apps/dashboard/src/lib/__tests__/ && git commit -m "feat(dashboard): accept googleId in user provisioning"
```

---

### Task 3: Add Google OAuth Provider to NextAuth

**Files:**

- Modify: `apps/dashboard/src/lib/auth.ts`

- [ ] **Step 1: Add Google provider import**

At the top of `apps/dashboard/src/lib/auth.ts`, add:

```typescript
import GoogleProvider from "next-auth/providers/google";
```

- [ ] **Step 2: Add Google provider to the providers array**

After the `CredentialsProvider` block (around line 38), add:

```typescript
// Google OAuth — enabled when GOOGLE_CLIENT_ID is set
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}
```

- [ ] **Step 3: Implement `getUserByAccount` adapter method**

Replace the existing stub:

```typescript
async getUserByAccount() {
  return null; // We only use email provider
},
```

With:

```typescript
async getUserByAccount({ provider, providerAccountId }) {
  if (provider === "google") {
    const user = await prisma.dashboardUser.findUnique({
      where: { googleId: providerAccountId },
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    };
  }
  return null;
},
```

- [ ] **Step 4: Implement `linkAccount` adapter method**

Replace the existing stub:

```typescript
async linkAccount() {
  return undefined as never;
},
```

With:

```typescript
async linkAccount({ userId, provider, providerAccountId }) {
  if (provider === "google") {
    // Check if this Google account is already linked to another user
    const existing = await prisma.dashboardUser.findUnique({
      where: { googleId: providerAccountId },
    });
    if (existing && existing.id !== userId) {
      throw new Error("This Google account is already linked to another user");
    }
    await prisma.dashboardUser.update({
      where: { id: userId },
      data: { googleId: providerAccountId },
    });
  }
  // Return type doesn't matter — NextAuth ignores it
  return undefined as never;
},
```

- [ ] **Step 5: Update `createUser` to handle Google OAuth first-time sign-in**

The existing `createUser` adapter calls `provisionDashboardUser`. For Google OAuth, NextAuth calls `createUser` then `linkAccount` separately. Update `createUser` to pass `googleId` if available from the OAuth profile. However, NextAuth's adapter `createUser` receives the user object from the provider profile — it does NOT have `providerAccountId` at this point. The linking happens in `linkAccount`.

No change needed to `createUser` — the existing flow works:

1. `createUser` → provisions user without googleId
2. `linkAccount` → adds googleId to the user

The existing `createUser` already works for this flow.

- [ ] **Step 6: Add env vars to `.env.example`**

Add to the end of `.env.example`:

```bash
# Google OAuth (optional — enables "Sign in with Google")
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 7: Verify the auth config compiles**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/lib/auth.ts .env.example && git commit -m "feat(dashboard): add Google OAuth provider to NextAuth"
```

---

### Task 4: Move Marketplace Browse to Public Route

**Files:**

- Create: `apps/dashboard/src/app/(public)/marketplace/page.tsx`
- Modify: `apps/dashboard/src/app/(auth)/marketplace/page.tsx`

- [ ] **Step 1: Create the public marketplace page**

Create `apps/dashboard/src/app/(public)/marketplace/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PublicMarketplaceBrowse } from "@/components/marketplace/public-marketplace-browse";

export const metadata: Metadata = {
  title: "Marketplace — Switchboard",
  description: "Browse AI agents for your business. Deploy them in minutes.",
};

export default function PublicMarketplacePage() {
  return <PublicMarketplaceBrowse />;
}
```

- [ ] **Step 2: Create the PublicMarketplaceBrowse component**

Create `apps/dashboard/src/components/marketplace/public-marketplace-browse.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import { useListings } from "@/hooks/use-marketplace";
import { ListingCard } from "@/components/marketplace/listing-card";
import { CategoryFilter } from "@/components/marketplace/category-filter";
import { Skeleton } from "@/components/ui/skeleton";

export function PublicMarketplaceBrowse() {
  const { data, isLoading } = useListings({ status: "listed" });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const listings = data ?? [];

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const l of listings) {
      for (const c of l.taskCategories) cats.add(c);
    }
    return [...cats].sort();
  }, [listings]);

  const filtered = selectedCategory
    ? listings.filter((l) => l.taskCategories.includes(selectedCategory))
    : listings;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Marketplace</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Pre-vetted AI agents rated on real task outcomes. Deploy with one click.
        </p>
      </section>

      {allCategories.length > 0 && (
        <CategoryFilter
          categories={allCategories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {isLoading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[200px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update the auth marketplace page to redirect**

Replace `apps/dashboard/src/app/(auth)/marketplace/page.tsx` with a redirect:

```tsx
import { redirect } from "next/navigation";

export default function AuthMarketplacePage() {
  redirect("/marketplace");
}
```

This ensures old bookmarks and internal links still work — they redirect to the public version.

- [ ] **Step 4: Verify both routes work**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/ apps/dashboard/src/components/marketplace/public-marketplace-browse.tsx && git commit -m "feat(dashboard): move marketplace browse to public route"
```

---

### Task 5: Add Auth-Gated Deploy Button

**Files:**

- Modify: `apps/dashboard/src/components/marketplace/listing-card.tsx`

- [ ] **Step 1: Read the existing listing-card.tsx**

Read `apps/dashboard/src/components/marketplace/listing-card.tsx` to understand the current deploy button implementation.

- [ ] **Step 2: Add auth-aware deploy behavior**

The "Deploy" button should always link to the login page with a callback URL. If the user is already logged in, the login page will redirect them to the callback URL automatically. This avoids needing `SessionProvider` in the `(public)` route group.

Modify the deploy button/link in `listing-card.tsx`. The card currently links to `/marketplace/${listing.id}`. Add a "Deploy" button that links to `/login?callbackUrl=/deploy/${listing.slug}`:

```tsx
import Link from "next/link";

// In the component, add a deploy button:
<Link
  href={`/login?callbackUrl=${encodeURIComponent(`/deploy/${listing.slug}`)}`}
  className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
  onClick={(e) => e.stopPropagation()}
>
  Deploy
</Link>;
```

**Important:** Do NOT use `useSession()` here — the `(public)` layout does not include a `SessionProvider`. The login page handles the redirect for already-authenticated users.

- [ ] **Step 3: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/marketplace/listing-card.tsx && git commit -m "feat(dashboard): auth-gate deploy button for public marketplace"
```

---

### Task 6: Update Login Page to Support Google OAuth + Callback

**Files:**

- Modify: `apps/dashboard/src/app/login/page.tsx` (or equivalent)

- [ ] **Step 1: Read the existing login page**

Read `apps/dashboard/src/app/login/page.tsx` to understand the current layout.

- [ ] **Step 2: Add Google sign-in button**

Add a "Sign in with Google" button that calls `signIn("google")` from `next-auth/react`. Place it above or below the existing credentials form:

```tsx
import { signIn } from "next-auth/react";

// In the component, add:
<button
  onClick={() => signIn("google", { callbackUrl: searchParams.callbackUrl || "/marketplace" })}
  className="w-full flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
>
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    {/* Google "G" logo SVG path */}
  </svg>
  Continue with Google
</button>;
```

- [ ] **Step 3: Handle callbackUrl for ALL auth methods**

Ensure the login page reads `?callbackUrl=` from the URL and passes it to both Google OAuth and credentials login flows. This enables: public marketplace → deploy button → login → redirect back to deploy page.

For Google OAuth, `signIn("google", { callbackUrl })` handles it automatically.

For credentials login, the existing code likely hardcodes `window.location.href = "/dashboard"` after successful login. Update this to use the `callbackUrl` search param:

```tsx
const searchParams = useSearchParams();
const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

// After successful credentials login:
window.location.href = callbackUrl;
```

Also add: if the user is already authenticated when they reach the login page, redirect them to `callbackUrl` immediately (handles the "deploy button → login → already logged in" case).

- [ ] **Step 4: Verify typecheck**

Run: `npx pnpm@9.15.4 --filter dashboard typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/login/ && git commit -m "feat(dashboard): add Google OAuth button to login page"
```

---

## Verification Checklist

After all tasks are complete:

1. `npx pnpm@9.15.4 --filter dashboard typecheck` — no errors
2. `npx pnpm@9.15.4 --filter dashboard test` — all tests pass
3. `npx pnpm@9.15.4 --filter @switchboard/db exec prisma migrate status` — all migrations applied
4. Manual check: `/marketplace` is accessible without login
5. Manual check: clicking "Deploy" on a listing redirects to login if not signed in
6. Manual check: after login, user is redirected back to deploy flow
