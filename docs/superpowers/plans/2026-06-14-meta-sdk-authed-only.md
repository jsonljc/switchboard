# Meta SDK authed-only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Meta's JavaScript SDK only in the authenticated dashboard, never on the unauthenticated surface (patient `/payment/*` pages, `/welcome`, `/privacy`, `/terms`, `/login`, password reset), while keeping the operator Meta connection flow working and demonstrable.

**Architecture:** Extract the SDK `<Script>` from the root layout into a dedicated `"use client"` component (`MetaSdkScript`) mounted only by the `(auth)` route-group layout. Move the `window.FB` global type to a dedicated `.d.ts`. Add the `connect.facebook.net` allowance to the global CSP `script-src` so the authed flow actually loads (it was fetch-blocked before); authed-only rendering (not the global CSP) is the public-surface guard. All changes land atomically in one PR.

**Tech Stack:** Next.js 14 (App Router, route groups), `next/script`, TypeScript, Vitest + jsdom + Testing Library, Prettier, Turborepo.

**Spec:** `docs/superpowers/specs/2026-06-14-meta-sdk-authed-only-design.md`

**Model routing (per `feedback_model_routing_by_phase`):** implementation tasks (1 to 4) run on Sonnet subagents; the gate (Task 5), running-app verification (Task 6), and the final code-review run on Opus. Mechanical-only edits may use Haiku. Never the weakest model as the final gate.

**Commit discipline:** explicit pathspecs only (never `git add -A`); Conventional Commits, lowercase subject; end every commit message with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
No em-dashes anywhere (code, comments, commit messages).

**Working directory for all commands:** `/Users/jasonli/switchboard/.claude/worktrees/meta-sdk-auth-only` (branch `fix/meta-sdk-auth-only`). Confirm with `git branch --show-current` before each commit.

---

### Setup (once, before Task 1)

Postgres is unreachable in this worktree, so `worktree-init` skipped the build. Vitest and the dashboard typecheck import `@switchboard/schemas`/`@switchboard/db` (and `db` depends on `core`), so build the whole graph once in dependency order (offline-safe, no DB needed):

- [ ] Run: `pnpm build` (full Turbo build: schemas, core, db, and apps in dependency order).
      Expected: green. If it reports missing exports or Prisma fields, run `pnpm reset` then re-run `pnpm build`.

---

### Task 1: Relocate the `window.FB` global type to a dedicated `.d.ts`

**Files:**

- Create: `apps/dashboard/src/types/facebook.d.ts`
- Modify: `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx:8-23`

Why: the loader (`MetaSdkScript`, Task 2) and the consumer (`whatsapp-embedded-signup.tsx`) both need the `window.FB` type. Today it is a `declare global` hidden inside the consumer, a brittle cross-file dependency. `src/types/` already holds global type files (`css.d.ts`, `next-auth.d.ts`) and is covered by tsconfig `include` (`**/*.ts`).

- [ ] **Step 1: Create the dedicated type file**

Create `apps/dashboard/src/types/facebook.d.ts` (ambient, non-module, so `interface Window` augments the global type):

```ts
// Global typing for Meta's JavaScript SDK (window.FB). Loaded by the
// MetaSdkScript loader (mounted only in the authed layout) and consumed by the
// WhatsApp embedded-signup flow.
interface Window {
  FB?: {
    init(params: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(
      callback: (response: { authResponse?: { accessToken: string } }) => void,
      params: {
        config_id: string;
        response_type: string;
        override_default_response_type: boolean;
        extras: Record<string, unknown>;
      },
    ): void;
  };
}
```

- [ ] **Step 2: Remove the inline `declare global` block from the consumer**

In `apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx`, delete the entire `declare global { ... }` block (lines 8 to 23) so the file goes straight from the lucide-react import to `interface Props`. The top of the file becomes:

```tsx
"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface Props {
  _metaAppId: string;
```

Leave the rest of the file (including the `window.FB.login(...)` call) unchanged; it now resolves against `facebook.d.ts`.

- [ ] **Step 3: Verify typecheck still passes**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: PASS (the consumer compiles against the relocated global type). If `window.FB` is reported as untyped, the `.d.ts` is not being picked up: confirm it sits under `src/` and matches `**/*.ts` in `apps/dashboard/tsconfig.json`.

- [ ] **Step 4: Commit**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/meta-sdk-auth-only
git branch --show-current   # must print: fix/meta-sdk-auth-only
git add apps/dashboard/src/types/facebook.d.ts \
        apps/dashboard/src/components/settings/whatsapp-embedded-signup.tsx
git commit -m "refactor(dashboard): move the window.FB global type to a dedicated d.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `MetaSdkScript` client component (the SDK loader)

**Files:**

- Create: `apps/dashboard/src/components/settings/meta-sdk-script.tsx`
- Test: `apps/dashboard/src/components/settings/__tests__/meta-sdk-script.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/dashboard/src/components/settings/__tests__/meta-sdk-script.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the props next/script receives without depending on lazyOnload's
// deferred injection in jsdom. vi.hoisted lets the mock factory (hoisted above
// imports) reference this array.
const { scriptProps } = vi.hoisted(() => ({
  scriptProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/script", () => ({
  default: (props: Record<string, unknown>) => {
    scriptProps.push(props);
    return null;
  },
}));

import { MetaSdkScript } from "@/components/settings/meta-sdk-script";

describe("MetaSdkScript", () => {
  beforeEach(() => {
    scriptProps.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders nothing when NEXT_PUBLIC_META_APP_ID is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "");
    render(<MetaSdkScript />);
    expect(scriptProps).toHaveLength(0);
  });

  it("loads the Facebook SDK with a stable id and lazyOnload when the app id is set", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app-id");
    render(<MetaSdkScript />);
    expect(scriptProps).toHaveLength(1);
    expect(scriptProps[0].id).toBe("meta-facebook-sdk");
    expect(scriptProps[0].src).toBe("https://connect.facebook.net/en_US/sdk.js");
    expect(scriptProps[0].strategy).toBe("lazyOnload");
  });

  it("initializes window.FB with the app id when the script loads", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app-id");
    const init = vi.fn();
    vi.stubGlobal("FB", { init });
    render(<MetaSdkScript />);
    (scriptProps[0].onLoad as () => void)();
    expect(init).toHaveBeenCalledWith({
      appId: "test-app-id",
      cookie: true,
      xfbml: true,
      version: "v21.0",
    });
  });

  it("does not throw on load when window.FB is unavailable", () => {
    vi.stubEnv("NEXT_PUBLIC_META_APP_ID", "test-app-id");
    render(<MetaSdkScript />);
    expect(() => (scriptProps[0].onLoad as () => void)()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- meta-sdk-script`
Expected: FAIL (module `@/components/settings/meta-sdk-script` not found).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/dashboard/src/components/settings/meta-sdk-script.tsx`:

```tsx
"use client";

import Script from "next/script";

/**
 * Loads Meta's JavaScript SDK and initializes window.FB for the operator Meta
 * connection flow (WhatsApp embedded signup on the settings page).
 *
 * Mounted ONLY by the (auth) route-group layout, so the SDK never loads on the
 * unauthenticated surface (patient payment pages, /welcome, /privacy, /terms,
 * /login, password reset). The window.FB type lives in src/types/facebook.d.ts.
 *
 * The env var is read as a static member access so Next.js inlines it
 * client-side; a dynamic bracket read would be undefined in the browser.
 */
export function MetaSdkScript() {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId) return null;

  return (
    <Script
      id="meta-facebook-sdk"
      src="https://connect.facebook.net/en_US/sdk.js"
      strategy="lazyOnload"
      onLoad={() => {
        window.FB?.init({
          appId,
          cookie: true,
          xfbml: true,
          version: "v21.0",
        });
      }}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- meta-sdk-script`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/meta-sdk-auth-only
git branch --show-current   # must print: fix/meta-sdk-auth-only
git add apps/dashboard/src/components/settings/meta-sdk-script.tsx \
        apps/dashboard/src/components/settings/__tests__/meta-sdk-script.test.tsx
git commit -m "feat(dashboard): add authed-only meta sdk loader component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Relocate the SDK to the `(auth)` layout, remove it from the root layout

**Files:**

- Modify: `apps/dashboard/src/app/(auth)/layout.tsx`
- Modify: `apps/dashboard/src/app/layout.tsx`
- Test: `apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts`

- [ ] **Step 1: Write the failing structural tripwire test**

Create `apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function readSource(rel: string): string {
  return readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// The Meta SDK is a third-party tracking script. It must load only in the
// authenticated app. These are cheap regression tripwires, NOT an authoritative
// guarantee (a regression hiding the URL behind a constant or dynamic import
// could slip past a source-text scan). The running-app network-panel check is
// the authoritative proof. See the spec, section 6.
describe("Meta SDK loads only in the authenticated app", () => {
  it("the (auth) layout mounts MetaSdkScript", () => {
    expect(readSource("src/app/(auth)/layout.tsx")).toContain("MetaSdkScript");
  });

  it("the root layout no longer references the Meta SDK", () => {
    const rootLayout = readSource("src/app/layout.tsx");
    expect(rootLayout).not.toContain("connect.facebook.net");
    expect(rootLayout).not.toContain("window.FB");
    expect(rootLayout).not.toContain("MetaSdkScript");
  });

  it("no file in the (public) route group references the Meta SDK", () => {
    const publicDir = path.resolve(process.cwd(), "src/app/(public)");
    const offenders = walk(publicDir).filter((file) => {
      const src = readFileSync(file, "utf8");
      return src.includes("connect.facebook.net") || src.includes("MetaSdkScript");
    });
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the SDK url is centralized in the MetaSdkScript component", () => {
    expect(readSource("src/components/settings/meta-sdk-script.tsx")).toContain(
      "connect.facebook.net",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- meta-sdk-surface`
Expected: FAIL (the `(auth)` layout does not yet mount `MetaSdkScript`; the root layout still contains `connect.facebook.net` and `window.FB`).

- [ ] **Step 3: Mount `MetaSdkScript` in the `(auth)` layout**

In `apps/dashboard/src/app/(auth)/layout.tsx`, add the import alongside the others and render `<MetaSdkScript />` after `<Toaster />`. The full file becomes:

```tsx
import { AuthProvider } from "@/providers/auth-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorChatWidget } from "@/components/operator-chat/operator-chat-widget";
import { Toaster } from "@/components/ui/toaster";
import { MetaSdkScript } from "@/components/settings/meta-sdk-script";
import { getServerSession } from "@/lib/session";
import { getDataMode } from "@/lib/data-mode/server";
import { isFixtureModeAllowed } from "@/lib/data-mode/shared";
import { DataModeProvider } from "@/lib/data-mode/client";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  const mode = await getDataMode();
  const dataModeControlsAllowed = isFixtureModeAllowed(process.env);

  return (
    <AuthProvider session={session}>
      <DataModeProvider mode={mode}>
        <ErrorBoundary>
          <AppShell dataModeControlsAllowed={dataModeControlsAllowed}>{children}</AppShell>
        </ErrorBoundary>
        <OperatorChatWidget />
        <Toaster />
        <MetaSdkScript />
      </DataModeProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Remove the SDK from the root layout**

In `apps/dashboard/src/app/layout.tsx`:

1. Delete the import line `import Script from "next/script";`.
2. Delete the Meta SDK block inside `<body>` (the `{process.env.NEXT_PUBLIC_META_APP_ID && (<Script .../>)}` expression).

The `<body>` element becomes exactly:

```tsx
<body className={inter.className}>
  <QueryProvider>{children}</QueryProvider>
</body>
```

Leave the rest of the file (font loaders, `metadata`, `<html>` attributes) unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- meta-sdk-surface`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/meta-sdk-auth-only
git branch --show-current   # must print: fix/meta-sdk-auth-only
git add "apps/dashboard/src/app/(auth)/layout.tsx" \
        apps/dashboard/src/app/layout.tsx \
        apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts
git commit -m "fix(dashboard): load meta sdk in the authed app only, not on public pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Allow `connect.facebook.net` in the CSP `script-src`

**Files:**

- Modify: `apps/dashboard/next.config.mjs:14`
- Test: `apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts` (append one assertion)

Why: the SDK host has never been in the CSP, so the browser fetch-blocks the SDK on every route today. The authed flow needs this allowance to load. Only `script-src` needs it: `img-src` already allows `https:` (fbcdn images) and `connect-src` already allows `https:` (graph XHRs). The allowance is global (Next `headers()` is global); render-time exclusion is the public-surface guard, so a comment records that tradeoff.

- [ ] **Step 1: Append the failing CSP assertion**

In `apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts`, append this `describe` block at the end (the config is read as source text and parsed directive-aware; importing `next.config.mjs` into a `.ts` test risks `tsc` friction, and the authoritative CSP check is the runtime header check in Task 6):

```ts
describe("dashboard CSP", () => {
  it("allows the Meta SDK host in the script-src directive", () => {
    const config = readFileSync(path.resolve(process.cwd(), "next.config.mjs"), "utf8");
    // Capture the script-src directive content (up to the next backtick or comma)
    // so the assertion targets the directive, not an unrelated line.
    const match = config.match(/script-src([^`,]*)/);
    expect(match, "script-src directive not found").not.toBeNull();
    expect(match![1]).toContain("https://connect.facebook.net");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- meta-sdk-surface`
Expected: FAIL on the new assertion (`script-src` does not yet contain `https://connect.facebook.net`).

- [ ] **Step 3: Add the allowance to the CSP with a guard comment**

In `apps/dashboard/next.config.mjs`, replace the `script-src` line (currently line 14):

```js
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
```

with:

```js
      // connect.facebook.net is allowed globally (Next headers() is global). The
      // SDK is rendered ONLY by the (auth) layout (MetaSdkScript), so only authed
      // pages load it. Render-time exclusion, not this allowance, is the
      // public-surface guard (see the meta-sdk-surface test and the spec).
      `script-src 'self' 'unsafe-inline' https://connect.facebook.net${isDev ? " 'unsafe-eval'" : ""}`,
```

No other directive changes. The allowance applies in both dev and prod (the operator flow runs in both, and local verification needs it in dev).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- meta-sdk-surface`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
cd /Users/jasonli/switchboard/.claude/worktrees/meta-sdk-auth-only
git branch --show-current   # must print: fix/meta-sdk-auth-only
git add apps/dashboard/next.config.mjs \
        apps/dashboard/src/app/__tests__/meta-sdk-surface.test.ts
git commit -m "fix(dashboard): permit the meta sdk host in script-src so the authed flow loads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full gate run (Opus)

**Files:** none (verification only).

- [ ] **Step 1: Build the workspace (deps + dashboard next build)**

Run: `pnpm build`
Expected: all packages build, including the dashboard `next build`. This satisfies the `pnpm --filter @switchboard/dashboard build` gate (the `next build` is part of it and catches missing `.js` extensions and route-group issues). If it reports missing exports from `@switchboard/schemas`/`@switchboard/db`/`@switchboard/core`, run `pnpm reset` then re-run `pnpm build`.

- [ ] **Step 2: Run the dashboard tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: PASS, including `meta-sdk-script` (4) and `meta-sdk-surface` (5). Coverage thresholds 40/35/40/40 still met.

- [ ] **Step 3: Typecheck, lint, format, arch**

Run each and confirm green:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm arch:check
```

If `format:check` flags the new files, run `pnpm format` then re-stage and amend the relevant commit (CI runs prettier; local lint does not). If any gate is red, fix and re-run before proceeding. Do not continue with a red gate.

---

### Task 6: Running-app verification (Opus, authoritative proof)

**Files:** none (observational; uses the `verify`/`run` skill to drive a real browser).

Goal: prove in the running app that public pages issue no `connect.facebook.net` request and define no `window.FB`, while an authed page loads the SDK and defines `window.FB`.

- [ ] **Step 1: Set local-only env for verification (never committed)**

In `apps/dashboard/.env.local` (git-ignored, local-only), ensure:

- `NEXT_PUBLIC_META_APP_ID` set to a dummy non-secret value (for example `000000000000000`) so the script renders.
- `DEV_BYPASS_AUTH=true` so authed pages are reachable without a login (confirm `worktree-init` did not comment it out; see memory `feedback_worktree_env_sync_corruption`).

Do not stage `.env.local`. Confirm `git status --short` does not list it.

- [ ] **Step 2: Launch the dashboard**

Use the `verify`/`run` skill to start the dashboard on port 3002 (detached). The static `/payment/*` pages do not need the API; start the API on 3000 too if an authed page needs data (the SDK presence check does not depend on API data).

- [ ] **Step 3: Verify the public surface is clean**

Drive a browser (Playwright/puppeteer via the verify skill). For `/payment/success`, `/payment/cancel`, and `/welcome`:

- Wait for network idle (lazyOnload defers; allow idle time).
- Assert NO network request URL contains `connect.facebook.net`.
- Evaluate `typeof window.FB` and assert it is `"undefined"`.

- [ ] **Step 4: Verify the authed surface loads the SDK**

Navigate to an authed page and reach `/settings` (dev bypass enabled):

- Assert a request to `https://connect.facebook.net/en_US/sdk.js` occurs and is not CSP-blocked (no CSP violation in the console).
- Evaluate `window.FB` and assert it is defined.
- Confirm the WhatsApp embedded-signup button (New Connection dialog, service `whatsapp`) renders without the "Meta SDK not loaded" error.

- [ ] **Step 5: Verify the emitted CSP header (authoritative CSP check)**

Run, against the running app:

```bash
curl -sI http://localhost:3002/settings | grep -i content-security-policy
curl -sI http://localhost:3002/payment/success | grep -i content-security-policy
```

Confirm the `Content-Security-Policy` header's `script-src` directive contains `https://connect.facebook.net` on both (the allowance is global; render-time exclusion is what keeps the public page clean, already proven in Step 3).

- [ ] **Step 6: Confirm static rendering**

From the `pnpm build` output (Task 5 Step 1), confirm `/payment/success` and `/payment/cancel` are listed as static (prerendered). If the summary scrolled, re-run `pnpm --filter @switchboard/dashboard build` and inspect the route table.

- [ ] **Step 7: Record the evidence (precise wording)**

Capture observations for the PR description. State exactly what is proven and what is not:

- Proven: public pages issue no SDK request and define no `window.FB`; the authed page requests the SDK with no CSP block and defines `window.FB`; the CSP header allows the host; `/payment/*` stay static.
- Not proven here: a real Meta business login / embedded-signup completing end-to-end (needs a real production app id and a real Meta business account). The PR will say "SDK availability and load-location verified," not "full Meta connection flow verified."

---

## Closeoff (after Task 6, not a TDD task)

1. Push the branch and open one focused PR to `main` with the Task 6 evidence.
2. Run code-review at high effort (Opus). Resolve every finding against the code (use `superpowers:receiving-code-review`).
3. Squash-merge only when CI is fully green and code-review has no unresolved high-severity finding. If a required check is red for a pre-existing repo-wide reason (for example the `pnpm audit` security gate on a fresh transitive advisory), rebase onto latest `origin/main` or fix it the repo's standard way rather than bypassing the gate; flag it if it is genuinely not ours to fix.
4. Land this spec and plan on `main` via a separate focused docs PR (branch doctrine: no planning docs on the implementation branch).
5. Same-day teardown: remove the worktree and prune, delete the merged branch (local and remote), `git fetch --prune`, fast-forward local `main`.
6. Update memory: mark the `project_receipted_bookings_architecture` #1015 follow-up resolved (and its index line). Note the section 4.5 embedded-signup readiness follow-up as the remaining open item.

## Self-review against the spec

- Goal 1 (public surface emits no SDK, no `window.FB`): Task 3 (relocation) and the `meta-sdk-surface` tripwire (incl. whole-`(public)`-subtree scan); proven in Task 6 Step 3.
- Goal 2 (authed app loads the SDK, operator flow works): Tasks 1 (type), 2 (loader), 3 (mount in `(auth)`), 4 (CSP allowance); proven in Task 6 Steps 4 and 5.
- Goal 3 (`/payment/*` stay public/static/no-PII/noindex): payment files untouched; confirmed static in Task 6 Step 6.
- Decision 1 (client component in `(auth)` layout, with `id`): Tasks 2 and 3.
- Decision 2 (scope = whole `(auth)` group; intentional breadth): Task 3 mounts in the group layout; tripwire covers root and the public subtree.
- Decision 3 (omit, no consent banner): no banner is built.
- Decision 4 (CSP allowance, global, script-src only; render-time exclusion is the guard): Task 4 (allowance + comment); directive-aware tripwire plus the runtime header check in Task 6 Step 5.
- Section 4.5 (lazyOnload readiness): documented as a follow-up; not implemented here.
- Type relocation (review item): Task 1.
- No placeholders; types consistent (`MetaSdkScript`, `scriptProps`, `window.FB.init` params, `id="meta-facebook-sdk"` match across tasks).
