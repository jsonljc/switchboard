# Dashboard Launch Track 3: Polish And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the last visible launch polish by adding real brand/share assets, removing prelaunch artifacts, shrinking dev-only code from production, and cleaning up low-priority test and maintenance debt.

**Architecture:** This track intentionally avoids security-critical or funnel-critical work. It focuses on production presentation, correctness of low-risk surfaces, and cleanup that makes the release feel finished without changing the core auth or onboarding architecture.

**Tech Stack:** Next.js metadata and public assets, React, Vitest, Testing Library, TypeScript

**Dependency:** Execute this track after Track 1 and Track 2 are green.

---

## File Map

- Modify: `apps/dashboard/src/app/layout.tsx`
- Modify: `apps/dashboard/src/app/(public)/layout.tsx`
- Modify: `apps/dashboard/src/app/(public)/pricing/page.tsx`
- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`
- Modify: `apps/dashboard/src/components/dev/dev-panel.tsx`
- Modify: `apps/dashboard/src/test-setup.ts`
- Modify: `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`
- Modify: `apps/dashboard/src/components/landing/__tests__/pricing-section.test.tsx`
- Modify: `apps/dashboard/src/lib/auth.ts`
- Modify: `apps/dashboard/package.json`
- Create: `apps/dashboard/public/favicon.ico`
- Create: `apps/dashboard/public/og-image.png`
- Create: `apps/dashboard/public/apple-touch-icon.png`
- Create: `docs/health/dashboard-launch-cleanup.md`

---

## Task 1: Add Real Brand And Share Assets

**Files:**

- Modify: `apps/dashboard/src/app/layout.tsx`
- Modify: `apps/dashboard/src/app/(public)/layout.tsx`
- Create: `apps/dashboard/public/favicon.ico`
- Create: `apps/dashboard/public/og-image.png`
- Create: `apps/dashboard/public/apple-touch-icon.png`

- [ ] **Step 1: Generate the missing assets**

Create these files:

- `apps/dashboard/public/favicon.ico`
- `apps/dashboard/public/apple-touch-icon.png`
- `apps/dashboard/public/og-image.png`

Asset requirements:

- favicon and touch icon use the shipped Switchboard brand mark
- OG image is 1200x630
- OG image includes the current positioning line used on the public site

- [ ] **Step 2: Wire metadata to the new assets**

```tsx
// apps/dashboard/src/app/layout.tsx
export const metadata: Metadata = {
  title: "Switchboard",
  description: "Your AI team runs the business. Stay in control, without the clutter.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};
```

```tsx
// apps/dashboard/src/app/(public)/layout.tsx
export const metadata: Metadata = {
  openGraph: {
    title: "Switchboard — Never miss a lead again",
    description:
      "AI booking agents that reply in seconds, qualify leads, and book appointments on WhatsApp, Telegram, or your website.",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};
```

- [ ] **Step 3: Verify**

Run:

```bash
find apps/dashboard/public -maxdepth 1 -type f | sort
pnpm --filter @switchboard/dashboard build
```

Expected:

- favicon, apple touch icon, and OG image exist
- metadata build succeeds with the new asset references

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/public/favicon.ico apps/dashboard/public/apple-touch-icon.png apps/dashboard/public/og-image.png apps/dashboard/src/app/layout.tsx apps/dashboard/src/app/(public)/layout.tsx
git commit -m "brand: add dashboard icons and share assets"
```

---

## Task 2: Remove Visible Prelaunch Artifacts

**Files:**

- Modify: `apps/dashboard/src/app/(public)/pricing/page.tsx`
- Modify: `docs/health/dashboard-launch-cleanup.md`

- [ ] **Step 1: Remove the launch-placeholder disclaimer**

```tsx
// apps/dashboard/src/app/(public)/pricing/page.tsx
// Delete:
// * Prices are illustrative — final pricing set at launch.
```

- [ ] **Step 2: Replace it with launch-ready trust copy only if pricing still needs context**

```tsx
// apps/dashboard/src/app/(public)/pricing/page.tsx
<p className="text-center text-xs text-[#9C958F]">
  Start with guided onboarding. Expand channels and workflows as your team goes live.
</p>
```

- [ ] **Step 3: Document the remaining public-site cleanup items**

```markdown
<!-- docs/health/dashboard-launch-cleanup.md -->

# Dashboard Launch Cleanup

- Pricing disclaimer removed
- Public metadata assets added
- Dev-only UI kept out of production
- Test setup normalized for browser APIs
```

- [ ] **Step 4: Verify**

Run:

```bash
rg -n "illustrative|final pricing set at launch" apps/dashboard/src
```

Expected: no matches

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/(public)/pricing/page.tsx docs/health/dashboard-launch-cleanup.md
git commit -m "copy: remove prelaunch pricing disclaimer"
```

---

## Task 3: Keep Dev-Only UI Out Of The Production Bundle

**Files:**

- Modify: `apps/dashboard/src/components/layout/app-shell.tsx`
- Modify: `apps/dashboard/src/components/dev/dev-panel.tsx`

- [ ] **Step 1: Stop importing the dev panel unconditionally**

```tsx
// apps/dashboard/src/components/layout/app-shell.tsx
import dynamic from "next/dynamic";

const DevPanel =
  process.env.NODE_ENV === "production"
    ? () => null
    : dynamic(() => import("../dev/dev-panel").then((mod) => mod.DevPanel), { ssr: false });
```

- [ ] **Step 2: Make the panel self-document its dev-only purpose**

```tsx
// apps/dashboard/src/components/dev/dev-panel.tsx
if (process.env.NODE_ENV === "production") return null;
```

- [ ] **Step 3: Verify**

Run:

```bash
pnpm --filter @switchboard/dashboard build
```

Expected: production build succeeds and `DevPanel` is not eagerly imported by the main app shell path

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/app-shell.tsx apps/dashboard/src/components/dev/dev-panel.tsx
git commit -m "perf: keep dev panel out of production path"
```

---

## Task 4: Clean Up Low-Priority Test And Maintenance Debt

**Files:**

- Modify: `apps/dashboard/src/test-setup.ts`
- Modify: `apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx`
- Modify: `apps/dashboard/src/components/landing/__tests__/pricing-section.test.tsx`
- Modify: `apps/dashboard/src/lib/auth.ts`
- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: Add a shared browser API mock for `matchMedia`**

```typescript
// apps/dashboard/src/test-setup.ts
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
```

- [ ] **Step 2: Update brittle tests to current copy and links**

```tsx
// apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx
expect(screen.getByRole("link", { name: /learn more/i })).toHaveAttribute(
  "href",
  "/agents/speed-to-lead",
);
```

```tsx
// apps/dashboard/src/components/landing/__tests__/pricing-section.test.tsx
expect(screen.getByRole("link", { name: /join waitlist|get started/i })).toBeInTheDocument();
```

- [ ] **Step 3: Remove dead NextAuth adapter methods that are unused under JWT strategy**

```typescript
// apps/dashboard/src/lib/auth.ts
// Remove:
// - createSession()
// - getSessionAndUser()
// - updateSession()
// - deleteSession()
//
// Keep the adapter methods still used by credentials, email, and OAuth account linking.
// The final adapter shape should match NextAuth's JWT strategy without persisting dashboard sessions.
```

- [ ] **Step 4: Record the Anthropic dependency decision**

```markdown
<!-- docs/health/dashboard-launch-cleanup.md -->

- `@anthropic-ai/sdk` remains in `apps/dashboard/package.json` because it is used by `src/app/(auth)/deploy/[slug]/actions.ts`
```

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @switchboard/dashboard test
pnpm --filter @switchboard/dashboard typecheck
```

Expected:

- `matchMedia` failures are gone from generic component tests
- landing tests match the current UI copy
- auth cleanup does not reintroduce NextAuth type errors

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/test-setup.ts apps/dashboard/src/components/landing/__tests__/agent-marketplace-card.test.tsx apps/dashboard/src/components/landing/__tests__/pricing-section.test.tsx apps/dashboard/src/lib/auth.ts apps/dashboard/package.json docs/health/dashboard-launch-cleanup.md
git commit -m "test: clean up dashboard launch debt"
```

---

## Task 5: Final Presentation Sweep

**Files:**

- Modify: `docs/DEPLOYMENT-CHECKLIST.md`

- [ ] **Step 1: Add the final polish checklist**

```markdown
<!-- docs/DEPLOYMENT-CHECKLIST.md -->

## Dashboard Presentation Sweep

1. Share the homepage URL in a link preview and confirm OG image renders
2. Open the site on iOS/macOS and confirm favicon/touch icon show
3. Confirm pricing page has no placeholder launch copy
4. Confirm no visible dev controls appear in production
```

- [ ] **Step 2: Run the manual sweep**

Expected: all four checks pass

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOYMENT-CHECKLIST.md
git commit -m "docs: add dashboard presentation sweep"
```
