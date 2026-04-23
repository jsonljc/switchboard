# SP1: Self-Serve Signup + Account Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new user can create an account from the public site, enter the authenticated dashboard, and reach onboarding without founder intervention.

**Architecture:** Add a `/signup` page that collects email + password and calls a new `/api/auth/register` route. The register route hashes the password, calls the existing `provisionDashboardUser` to create the full account stack (org, principal, identity spec, dashboard user + API key) in a single transaction, and returns 201. The signup page then auto-signs in via `signIn("credentials", ...)` and redirects to `/onboarding`. All public CTAs are updated to point to `/signup` instead of `/get-started` when `NEXT_PUBLIC_LAUNCH_MODE=beta`. The waitlist path stays alive for `waitlist` mode.

**Tech Stack:** Next.js 14 (App Router), NextAuth v5 beta, bcryptjs, Prisma, Vitest

**Key discovery:** The `api-client.ts` "missing file" from the audit is a false alarm — `apps/dashboard/src/lib/api-client/` exists as a directory with `index.ts` barrel file. The import `from "./api-client"` resolves correctly via Node module resolution. TypeScript confirms no import errors. This task is removed from SP1.

---

## File Structure

| Action | Path                                                                  | Responsibility                    |
| ------ | --------------------------------------------------------------------- | --------------------------------- |
| Create | `apps/dashboard/src/app/api/auth/register/route.ts`                   | Registration API endpoint         |
| Create | `apps/dashboard/src/app/(public)/signup/page.tsx`                     | Public signup page                |
| Create | `apps/dashboard/src/lib/__tests__/register.test.ts`                   | Registration logic tests          |
| Edit   | `apps/dashboard/src/app/login/page.tsx`                               | Fix "Don't have an account?" link |
| Edit   | `apps/dashboard/src/components/landing/homepage-hero.tsx`             | CTA target                        |
| Edit   | `apps/dashboard/src/components/landing/final-cta.tsx`                 | CTA target                        |
| Edit   | `apps/dashboard/src/components/landing/pricing-section.tsx`           | CTA target                        |
| Edit   | `apps/dashboard/src/components/landing/landing-nav.tsx`               | Nav CTA target                    |
| Edit   | `apps/dashboard/src/components/landing/__tests__/landing-nav.test.ts` | Update test assertion             |

---

### Task 1: Registration API Endpoint

**Files:**

- Create: `apps/dashboard/src/app/api/auth/register/route.ts`
- Create: `apps/dashboard/src/lib/__tests__/register.test.ts`
- Reference: `apps/dashboard/src/lib/provision-dashboard-user.ts`
- Reference: `apps/dashboard/src/lib/password.ts`

- [ ] **Step 1: Write the registration logic tests**

Create `apps/dashboard/src/lib/__tests__/register.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => ({
    dashboardUser: { findUnique: mockFindUnique },
    $transaction: mockTransaction,
  })),
}));

vi.mock("../provision-dashboard-user", () => ({
  provisionDashboardUser: vi.fn(async (_prisma, input) => ({
    id: "test-id",
    email: input.email,
    name: null,
    organizationId: "org_test",
    principalId: "principal_test",
    emailVerified: null,
  })),
}));

import { validateRegistration } from "../register";

describe("validateRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing email", () => {
    const result = validateRegistration("", "password123!");
    expect(result).toEqual({ valid: false, error: "Email is required" });
  });

  it("rejects invalid email format", () => {
    const result = validateRegistration("not-an-email", "password123!");
    expect(result).toEqual({ valid: false, error: "Invalid email address" });
  });

  it("rejects missing password", () => {
    const result = validateRegistration("user@example.com", "");
    expect(result).toEqual({ valid: false, error: "Password is required" });
  });

  it("rejects password shorter than 8 characters", () => {
    const result = validateRegistration("user@example.com", "short");
    expect(result).toEqual({
      valid: false,
      error: "Password must be at least 8 characters",
    });
  });

  it("accepts valid email and password", () => {
    const result = validateRegistration("user@example.com", "password123!");
    expect(result).toEqual({ valid: true, error: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx vitest run src/lib/__tests__/register.test.ts`
Expected: FAIL — `validateRegistration` not found

- [ ] **Step 3: Write the validation function**

Create `apps/dashboard/src/lib/register.ts`:

```typescript
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateRegistration(
  email: string,
  password: string,
): { valid: true; error: null } | { valid: false; error: string } {
  if (!email) return { valid: false, error: "Email is required" };
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: "Invalid email address" };
  if (!password) return { valid: false, error: "Password is required" };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  return { valid: true, error: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx vitest run src/lib/__tests__/register.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Create the registration API route**

Create `apps/dashboard/src/app/api/auth/register/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "@/lib/password";
import { provisionDashboardUser } from "@/lib/provision-dashboard-user";
import { validateRegistration } from "@/lib/register";

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient());

export async function POST(request: NextRequest) {
  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  if (launchMode !== "beta") {
    return NextResponse.json(
      { error: "Registration is not available. Join the waitlist instead." },
      { status: 403 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const validation = validateRegistration(email, password);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const existing = await prisma.dashboardUser.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  const dashboardUser = await provisionDashboardUser(prisma, {
    email,
    name: null,
    emailVerified: null,
  });

  await prisma.dashboardUser.update({
    where: { id: dashboardUser.id },
    data: { passwordHash },
  });

  return NextResponse.json(
    {
      id: dashboardUser.id,
      email: dashboardUser.email,
      organizationId: dashboardUser.organizationId,
    },
    { status: 201 },
  );
}
```

- [ ] **Step 6: Run typecheck to verify no type errors**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No errors (the existing crypto.test.ts error is pre-existing)

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add registration API endpoint and validation

Adds POST /api/auth/register with email/password validation, duplicate
check, and account provisioning via provisionDashboardUser. Gated by
NEXT_PUBLIC_LAUNCH_MODE=beta.
EOF
)"
```

---

### Task 2: Signup Page

**Files:**

- Create: `apps/dashboard/src/app/(public)/signup/page.tsx`
- Reference: `apps/dashboard/src/app/login/page.tsx` (for styling patterns)

- [ ] **Step 1: Create the signup page**

Create `apps/dashboard/src/app/(public)/signup/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";

  if (launchMode !== "beta") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1A1714",
          color: "#EDE8E1",
          padding: "2rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "24rem" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>
            Not yet open
          </h1>
          <p style={{ color: "#7A736C", marginBottom: "2rem" }}>
            Registration is currently invite-only.
          </p>
          <Link href="/get-started" style={{ color: "#A07850", textDecoration: "underline" }}>
            Join the waitlist
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      const signInResult = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInResult?.error) {
        setError("Account created but sign-in failed. Please log in manually.");
        setLoading(false);
        return;
      }

      window.location.href = "/onboarding";
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1A1714",
        padding: "2rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "24rem" }}>
        <h1
          style={{
            fontSize: "1.75rem",
            fontWeight: 700,
            color: "#EDE8E1",
            marginBottom: "0.5rem",
          }}
        >
          Create your account
        </h1>
        <p style={{ color: "#7A736C", marginBottom: "2rem" }}>
          Start your free beta — no credit card required.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="email"
            style={{
              display: "block",
              color: "#A09A93",
              fontSize: "0.875rem",
              marginBottom: "0.375rem",
            }}
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#2A2520",
              border: "1px solid #3D3730",
              borderRadius: "0.5rem",
              color: "#EDE8E1",
              marginBottom: "1rem",
              outline: "none",
            }}
          />

          <label
            htmlFor="password"
            style={{
              display: "block",
              color: "#A09A93",
              fontSize: "0.875rem",
              marginBottom: "0.375rem",
            }}
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#2A2520",
              border: "1px solid #3D3730",
              borderRadius: "0.5rem",
              color: "#EDE8E1",
              marginBottom: "1rem",
              outline: "none",
            }}
          />

          <label
            htmlFor="confirmPassword"
            style={{
              display: "block",
              color: "#A09A93",
              fontSize: "0.875rem",
              marginBottom: "0.375rem",
            }}
          >
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: "#2A2520",
              border: "1px solid #3D3730",
              borderRadius: "0.5rem",
              color: "#EDE8E1",
              marginBottom: "1.5rem",
              outline: "none",
            }}
          />

          {error && (
            <p style={{ color: "#E5484D", fontSize: "0.875rem", marginBottom: "1rem" }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "0.75rem",
              background: loading ? "#7A736C" : "#A07850",
              color: "#1A1714",
              borderRadius: "9999px",
              border: "none",
              fontWeight: 600,
              fontSize: "0.9375rem",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            marginTop: "1.5rem",
            color: "#7A736C",
            fontSize: "0.875rem",
          }}
        >
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#A07850" }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders without type errors**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): add public signup page

Creates /signup with email/password/confirm form. Auto-signs in after
registration and redirects to /onboarding. Redirects to waitlist when
LAUNCH_MODE is not beta.
EOF
)"
```

---

### Task 3: Login Page Link Fix

**Files:**

- Edit: `apps/dashboard/src/app/login/page.tsx:458-474`

- [ ] **Step 1: Fix the "Don't have an account?" link**

In `apps/dashboard/src/app/login/page.tsx`, find the link at approximately line 458-474 and change the href from `"/"` to `"/signup"`:

Change:

```tsx
href = "/";
```

To:

```tsx
href = "/signup";
```

This is the `<Link>` inside the "Don't have an account? Get started" text block at the bottom of the login page.

- [ ] **Step 2: Verify no type errors introduced**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(dashboard): link login page to signup instead of homepage

Changes "Don't have an account?" link from / (homepage dead loop) to
/signup so new users can actually register.
EOF
)"
```

---

### Task 4: Public CTA Updates

**Files:**

- Edit: `apps/dashboard/src/components/landing/homepage-hero.tsx`
- Edit: `apps/dashboard/src/components/landing/final-cta.tsx:30`
- Edit: `apps/dashboard/src/components/landing/pricing-section.tsx:167`
- Edit: `apps/dashboard/src/components/landing/landing-nav.tsx:124,273`
- Edit: `apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx:45`

All CTA changes follow the same pattern: link to `/signup` when in beta mode, `/get-started` when in waitlist mode.

- [ ] **Step 1: Create a shared CTA href helper**

Create a small helper to avoid repeating the launch-mode check in every component. Add to `apps/dashboard/src/lib/launch-mode.ts`:

```typescript
export function getCtaHref(): string {
  const mode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  return mode === "beta" ? "/signup" : "/get-started";
}

export function getCtaLabel(): string {
  const mode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  return mode === "beta" ? "Start free beta" : "Get early access";
}
```

- [ ] **Step 2: Update homepage-hero.tsx**

In `apps/dashboard/src/components/landing/homepage-hero.tsx`, the hero currently has no signup/get-started CTA (primary CTA is anchor link `#conversation-demo`, secondary is `/how-it-works`). Add a third CTA that links to signup:

Add import at top:

```typescript
import { getCtaHref, getCtaLabel } from "@/lib/launch-mode";
```

Find the secondary CTA (`How it works` link) and add a primary CTA button before it:

```tsx
<a
  href={getCtaHref()}
  style={{
    display: "inline-flex",
    alignItems: "center",
    background: "#A07850",
    color: "#1A1714",
    borderRadius: "9999px",
    padding: "0.875rem 2rem",
    fontSize: "0.9375rem",
    fontWeight: 600,
    textDecoration: "none",
  }}
>
  {getCtaLabel()} →
</a>
```

- [ ] **Step 3: Update final-cta.tsx**

In `apps/dashboard/src/components/landing/final-cta.tsx`, change line 30:

Add import at top:

```typescript
import { getCtaHref, getCtaLabel } from "@/lib/launch-mode";
```

Change:

```tsx
href = "/get-started";
```

To:

```tsx
            href={getCtaHref()}
```

Change the button text from `"Get started →"` to use `getCtaLabel()`:

```tsx
              {getCtaLabel()} →
```

- [ ] **Step 4: Update pricing-section.tsx**

In `apps/dashboard/src/components/landing/pricing-section.tsx`, change line 167:

Add import at top:

```typescript
import { getCtaHref } from "@/lib/launch-mode";
```

Change:

```tsx
href = "/get-started";
```

To:

```tsx
              href={getCtaHref()}
```

- [ ] **Step 5: Update landing-nav.tsx**

In `apps/dashboard/src/components/landing/landing-nav.tsx`, change lines 124 and 273:

Add import at top:

```typescript
import { getCtaHref, getCtaLabel } from "@/lib/launch-mode";
```

Change both instances:

```tsx
href = "/get-started";
```

To:

```tsx
              href={getCtaHref()}
```

And update the CTA text from `"Get early access"` to `{getCtaLabel()}`.

- [ ] **Step 6: Update landing-nav test**

In `apps/dashboard/src/components/landing/__tests__/landing-nav.test.tsx`, line 45 asserts the CTA href is `"/get-started"`. Since the default `NEXT_PUBLIC_LAUNCH_MODE` is `waitlist`, the default href should still be `"/get-started"`, so this test should still pass. Verify:

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx vitest run src/components/landing/__tests__/landing-nav.test.tsx`
Expected: PASS

- [ ] **Step 7: Verify no type errors**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 8: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): update public CTAs for launch mode gating

All public-site CTAs now use getCtaHref/getCtaLabel helpers. In beta
mode, CTAs point to /signup. In waitlist mode (default), they point to
/get-started as before.
EOF
)"
```

---

### Task 5: Launch Mode Gate on Signup Route

The signup page already redirects to waitlist when `LAUNCH_MODE !== "beta"` (client-side), and the register API already returns 403 in non-beta mode (server-side). But the middleware doesn't block direct `/signup` access. We need to ensure direct URL access to `/signup` also respects the gate.

**Files:**

- Edit: `apps/dashboard/src/middleware.ts`

- [ ] **Step 1: Add launch mode redirect to middleware**

In `apps/dashboard/src/middleware.ts`, add a redirect for `/signup` when not in beta mode. Add this block before the `isAuthPage` check (after the rate limiting block, around line 79):

```typescript
// Block /signup in non-beta mode at the middleware level
if (pathname === "/signup") {
  const launchMode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  if (launchMode !== "beta") {
    return NextResponse.redirect(new URL("/get-started", request.url));
  }
}
```

Also add `"/signup"` to the matcher config:

```typescript
export const config = {
  matcher: [
    "/signup",
    "/api/dashboard/:path*",
    // ... existing matchers
  ],
};
```

- [ ] **Step 2: Verify no type errors**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx tsc --noEmit 2>&1 | grep -v crypto.test.ts`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(dashboard): gate /signup route in middleware for launch mode

Direct /signup access redirects to /get-started in waitlist mode.
Prevents users from bypassing the waitlist by navigating directly to
the signup URL.
EOF
)"
```

---

### Task 6: Route-Level Tests + Final Verification

**Files:**

- Create: `apps/dashboard/src/app/api/auth/register/__tests__/route.test.ts`

- [ ] **Step 1: Write route-level tests for the register endpoint**

Create `apps/dashboard/src/app/api/auth/register/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockProvision = vi.fn();

vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(() => ({
    dashboardUser: { findUnique: mockFindUnique, update: mockUpdate },
  })),
}));

vi.mock("@/lib/provision-dashboard-user", () => ({
  provisionDashboardUser: mockProvision,
}));

vi.mock("@/lib/password", () => ({
  hashPassword: vi.fn(async () => "$2a$12$mockedhash"),
}));

vi.mock("@/lib/register", async () => {
  const actual = await vi.importActual<typeof import("@/lib/register")>("@/lib/register");
  return actual;
});

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "beta");
    mockProvision.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
      organizationId: "org-1",
      principalId: "principal-1",
    });
  });

  async function callRegister(body: Record<string, unknown>) {
    const { POST } = await import("../route");
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return POST(req);
  }

  it("returns 403 when launch mode is waitlist", async () => {
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "waitlist");
    const res = await callRegister({ email: "a@b.com", password: "12345678" });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("not available");
  });

  it("returns 400 for missing email", async () => {
    const res = await callRegister({ email: "", password: "12345678" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for short password", async () => {
    const res = await callRegister({ email: "a@b.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("returns 409 for duplicate email", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing", email: "a@b.com" });
    const res = await callRegister({ email: "a@b.com", password: "12345678" });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("already exists");
  });

  it("returns 201 and provisions account for valid input", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await callRegister({ email: "new@example.com", password: "securepass!" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.email).toBe("test@example.com");
    expect(data.organizationId).toBe("org-1");
    expect(mockProvision).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run route tests**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard exec -- npx vitest run src/app/api/auth/register/__tests__/route.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 3: Run the full dashboard test suite for regressions**

Run: `npx pnpm@9.15.4 --filter @switchboard/dashboard test`
Expected: All existing tests pass, new tests pass

- [ ] **Step 4: Run full project typecheck**

Run: `npx pnpm@9.15.4 typecheck`
Expected: Pass (aside from pre-existing crypto.test.ts error)

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(dashboard): add route-level tests for registration endpoint

Tests launch mode gating, input validation, duplicate rejection, and
successful account provisioning at the API route level.
EOF
)"
```

---

## Post-Implementation Verification

After all tasks are complete, verify SP1's pass condition:

1. **Set `NEXT_PUBLIC_LAUNCH_MODE=beta` in `.env`**
2. **Start the dashboard**: `npx pnpm@9.15.4 --filter @switchboard/dashboard dev`
3. **Visit the homepage**: CTAs should say "Start free beta" and link to `/signup`
4. **Navigate to `/signup`**: Registration form should appear
5. **Create an account**: Fill email + password + confirm, submit
6. **Verify auto-sign-in**: Should redirect to `/onboarding`
7. **Verify dashboard access**: Navigate to `/dashboard` — should load without 500 errors
   7a. **Smoke-test a server-backed route**: Navigate to `/decide` or `/settings` — these use `getApiClient()` which hits the `api-client/` barrel. Confirm no 500/import crash. This explicitly verifies the pass condition "core dashboard server routes do not 500"
8. **Test waitlist mode**: Set `NEXT_PUBLIC_LAUNCH_MODE=waitlist`, restart. `/signup` should redirect to `/get-started`. CTAs should say "Get early access".
9. **Test login link**: On the login page, "Don't have an account?" should link to `/signup`

**SP1 pass condition met when:** A new user can go from homepage → signup → account creation → authenticated dashboard → onboarding entry without founder intervention, and core dashboard server routes do not 500.
