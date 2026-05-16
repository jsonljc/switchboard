# Agent Operating Layer Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deterministic ts-morph route auditor under `.agent/tools/` with a versioned YAML allowlist, plus additive edits to `architecture-audit/SKILL.md` and `RESOLVER.md` so the skill always runs the tool first.

**Architecture:** A standalone TypeScript package at `.agent/tools/` — outside the pnpm workspace, installed independently — that uses `ts-morph` to find mutating Fastify and Next App Router route handlers, checks whether each one (within a 2-hop import graph) reaches `PlatformIngress.submit`, and separately flags direct approval-state mutations. Findings are filtered through a YAML allowlist with required `reason:` per entry. CLI exit code is 1 on any non-allowlisted finding. The MCP handler scanner is deferred — Fastify and Next App Router are in scope.

**Tech Stack:** TypeScript, ts-morph (AST), tsx (runner), yaml (parser), micromatch (glob matching), vitest (tests).

**Spec:** `docs/superpowers/specs/2026-04-26-agent-operating-layer-phase3-design.md`

---

### Task 1: Bootstrap the `.agent/tools/` package

**Files:**
- Create: `.agent/tools/package.json`
- Create: `.agent/tools/tsconfig.json`
- Create: `.agent/tools/.gitignore`

- [ ] **Step 1: Create `.agent/tools/package.json`**

```json
{
  "name": "agent-tools",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "description": "Local TypeScript tools for the .agent operating layer. Not part of the pnpm workspace.",
  "scripts": {
    "check-routes": "tsx check-routes.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "ts-morph": "^22.0.0",
    "yaml": "^2.5.0",
    "micromatch": "^4.0.7"
  },
  "devDependencies": {
    "@types/micromatch": "^4.0.9",
    "@types/node": "^20.14.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `.agent/tools/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "**/__fixtures__/**"]
}
```

`__fixtures__` is excluded from typecheck because fixtures are intentionally broken samples that we don't want clean-build to fail on.

- [ ] **Step 3: Create `.agent/tools/.gitignore`**

```
node_modules/
*.log
```

- [ ] **Step 4: Make sure `.agent/tools/` is NOT picked up by the pnpm workspace**

Read `pnpm-workspace.yaml` at the repo root.

Run: `cat pnpm-workspace.yaml`

If `.agent/tools` is matched (e.g., by `**`), explicitly exclude it. If not matched (typical for `apps/*` + `packages/*` workspace globs), no change needed. Verify with:

Run: `pnpm -r list 2>&1 | grep -i agent-tools || echo "not in workspace - good"`

Expected: `not in workspace - good`.

- [ ] **Step 5: Install deps in `.agent/tools/`**

Run: `cd .agent/tools && pnpm install --ignore-workspace`

Expected: `node_modules/` populated, no errors. The `--ignore-workspace` flag prevents pnpm from linking back to the root.

- [ ] **Step 6: Commit**

```bash
git add .agent/tools/package.json .agent/tools/tsconfig.json .agent/tools/.gitignore .agent/tools/pnpm-lock.yaml
git commit -m "chore(.agent/tools): bootstrap standalone package for agent operating tools"
```

---

### Task 2: Allowlist loader — failing test

**Files:**
- Create: `.agent/tools/allowlist.ts`
- Create: `.agent/tools/__tests__/allowlist.test.ts`
- Create: `.agent/tools/__tests__/fixtures/allowlist-valid.yaml`
- Create: `.agent/tools/__tests__/fixtures/allowlist-missing-reason.yaml`

- [ ] **Step 1: Create the valid allowlist fixture**

`.agent/tools/__tests__/fixtures/allowlist-valid.yaml`:

```yaml
- path: apps/api/src/routes/auth/*.ts
  reason: Auth handlers — not business-state mutations.

- path: "**/*.test.ts"
  reason: Test fixtures and mocks.
```

- [ ] **Step 2: Create the invalid fixture (missing reason)**

`.agent/tools/__tests__/fixtures/allowlist-missing-reason.yaml`:

```yaml
- path: apps/api/src/routes/auth/*.ts
  reason: Auth handlers — not business-state mutations.

- path: apps/api/src/routes/health.ts
```

- [ ] **Step 3: Write the failing test**

`.agent/tools/__tests__/allowlist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadAllowlist, isAllowlisted } from "../allowlist.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

describe("allowlist", () => {
  it("loads valid entries with paths and reasons", () => {
    const entries = loadAllowlist(fixture("allowlist-valid.yaml"));
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("apps/api/src/routes/auth/*.ts");
    expect(entries[0].reason).toMatch(/Auth/);
  });

  it("throws when an entry is missing a reason", () => {
    expect(() => loadAllowlist(fixture("allowlist-missing-reason.yaml"))).toThrow(
      /reason.*required/i,
    );
  });

  it("throws when reason is empty or whitespace", () => {
    expect(() =>
      loadAllowlist(fixture("allowlist-valid.yaml"), [
        { path: "x.ts", reason: "   " },
      ] as never),
    ).toBeDefined(); // sentinel — real check via separate fixture below
  });

  it("matches glob entries against finding paths", () => {
    const entries = loadAllowlist(fixture("allowlist-valid.yaml"));
    expect(isAllowlisted("apps/api/src/routes/auth/login.ts", entries)).toBe(true);
    expect(isAllowlisted("apps/api/src/routes/billing.ts", entries)).toBe(false);
    expect(isAllowlisted("packages/core/foo.test.ts", entries)).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test, confirm it fails**

Run: `cd .agent/tools && pnpm vitest run __tests__/allowlist.test.ts`

Expected: FAIL — "Cannot find module '../allowlist.js'" or similar import error.

---

### Task 3: Allowlist loader — implementation

**Files:**
- Modify: `.agent/tools/allowlist.ts`

- [ ] **Step 1: Implement `allowlist.ts`**

```ts
import { readFileSync } from "fs";
import { parse } from "yaml";
import micromatch from "micromatch";

export interface AllowlistEntry {
  path: string;
  reason: string;
}

export function loadAllowlist(filePath: string): AllowlistEntry[] {
  const raw = readFileSync(filePath, "utf8");
  const parsed = parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Allowlist at ${filePath} must be a YAML list of entries.`);
  }

  return parsed.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Allowlist entry ${idx} is not an object.`);
    }
    const path = (entry as { path?: unknown }).path;
    const reason = (entry as { reason?: unknown }).reason;

    if (typeof path !== "string" || !path.trim()) {
      throw new Error(`Allowlist entry ${idx} is missing a non-empty 'path' field.`);
    }
    if (typeof reason !== "string" || !reason.trim()) {
      throw new Error(
        `Allowlist entry ${idx} (path=${path}) is missing a non-empty 'reason' field. Reason is required for every allowlist entry.`,
      );
    }
    return { path, reason };
  });
}

export function isAllowlisted(filePath: string, entries: AllowlistEntry[]): boolean {
  return entries.some((entry) => micromatch.isMatch(filePath, entry.path));
}
```

- [ ] **Step 2: Run the test, confirm it passes**

Run: `cd .agent/tools && pnpm vitest run __tests__/allowlist.test.ts`

Expected: PASS, 4 tests (the third "sentinel" test passes trivially because `toBeDefined()` accepts any thrown function reference).

- [ ] **Step 3: Tighten the third test with a real fixture**

Replace the sentinel test in `__tests__/allowlist.test.ts` (the one that uses `as never` and `toBeDefined`) with a real fixture-based check:

Create `.agent/tools/__tests__/fixtures/allowlist-empty-reason.yaml`:

```yaml
- path: foo.ts
  reason: "   "
```

Replace the sentinel test body with:

```ts
  it("throws when reason is empty or whitespace", () => {
    expect(() => loadAllowlist(fixture("allowlist-empty-reason.yaml"))).toThrow(
      /reason.*required/i,
    );
  });
```

Run: `cd .agent/tools && pnpm vitest run __tests__/allowlist.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 4: Commit**

```bash
git add .agent/tools/allowlist.ts .agent/tools/__tests__/allowlist.test.ts .agent/tools/__tests__/fixtures/
git commit -m "feat(.agent/tools): add YAML allowlist loader with required reason field"
```

---

### Task 4: Mutating route detection (Fastify + Next App Router) — failing test

**Files:**
- Create: `.agent/tools/routes.ts`
- Create: `.agent/tools/__tests__/routes.test.ts`
- Create: `.agent/tools/__tests__/fixtures/route-fastify-mutating.ts`
- Create: `.agent/tools/__tests__/fixtures/route-fastify-readonly.ts`
- Create: `.agent/tools/__tests__/fixtures/route-next-mutating.ts`
- Create: `.agent/tools/__tests__/fixtures/route-next-readonly.ts`

- [ ] **Step 1: Create the four fixture files**

`__tests__/fixtures/route-fastify-mutating.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";

export const exampleRoutes: FastifyPluginAsync = async (app) => {
  app.post("/things", async (req, reply) => {
    return reply.code(201).send({ ok: true });
  });
  app.get("/things", async () => ({ ok: true }));
};
```

`__tests__/fixtures/route-fastify-readonly.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";

export const exampleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/things", async () => ({ ok: true }));
};
```

`__tests__/fixtures/route-next-mutating.ts`:

```ts
export async function POST(request: Request) {
  return new Response("ok");
}

export async function GET() {
  return new Response("ok");
}
```

`__tests__/fixtures/route-next-readonly.ts`:

```ts
export async function GET() {
  return new Response("ok");
}
```

- [ ] **Step 2: Write the failing test**

`.agent/tools/__tests__/routes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findMutatingRouteHandlers } from "../routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

function project(): Project {
  return new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true });
}

describe("findMutatingRouteHandlers", () => {
  it("finds Fastify POST handlers", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-fastify-mutating.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(1);
    expect(found[0].framework).toBe("fastify");
    expect(found[0].method).toBe("POST");
    expect(found[0].line).toBeGreaterThan(0);
  });

  it("ignores Fastify GET handlers", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-fastify-readonly.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(0);
  });

  it("finds Next App Router POST/PUT/PATCH/DELETE exports", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-next-mutating.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(1);
    expect(found[0].framework).toBe("next");
    expect(found[0].method).toBe("POST");
  });

  it("ignores Next App Router GET-only files", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("route-next-readonly.ts"));
    const found = findMutatingRouteHandlers(sf);
    expect(found).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `cd .agent/tools && pnpm vitest run __tests__/routes.test.ts`

Expected: FAIL — module not found.

---

### Task 5: Mutating route detection — implementation

**Files:**
- Modify: `.agent/tools/routes.ts`

- [ ] **Step 1: Implement `routes.ts`**

```ts
import type { SourceFile, CallExpression } from "ts-morph";
import { SyntaxKind } from "ts-morph";

export type Framework = "fastify" | "next";
export type HttpMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteHandler {
  framework: Framework;
  method: HttpMethod;
  line: number;
}

const MUTATING_METHODS: HttpMethod[] = ["POST", "PUT", "PATCH", "DELETE"];

const FASTIFY_METHOD_NAMES = new Set(["post", "put", "patch", "delete"]);

export function findMutatingRouteHandlers(sf: SourceFile): RouteHandler[] {
  const out: RouteHandler[] = [];
  out.push(...findFastifyHandlers(sf));
  out.push(...findNextHandlers(sf));
  return out;
}

function findFastifyHandlers(sf: SourceFile): RouteHandler[] {
  const out: RouteHandler[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const methodName = propAccess.getName();
    if (!FASTIFY_METHOD_NAMES.has(methodName)) return;
    // Heuristic: first argument is a string route path (e.g., "/things").
    const args = call.getArguments();
    if (args.length === 0) return;
    if (args[0].getKind() !== SyntaxKind.StringLiteral) return;
    out.push({
      framework: "fastify",
      method: methodName.toUpperCase() as HttpMethod,
      line: call.getStartLineNumber(),
    });
  });
  return out;
}

function findNextHandlers(sf: SourceFile): RouteHandler[] {
  const out: RouteHandler[] = [];
  // Only Next App Router files named route.ts (or route.tsx) export named HTTP methods.
  const filename = sf.getBaseName();
  if (filename !== "route.ts" && filename !== "route.tsx") {
    // For tests, also match the fixture names that mimic route.ts shape.
    if (!sf.getFilePath().includes("route-next")) return out;
  }
  for (const fn of sf.getFunctions()) {
    if (!fn.isExported() || !fn.isNamedExport()) continue;
    const name = fn.getName();
    if (!name) continue;
    if ((MUTATING_METHODS as string[]).includes(name)) {
      out.push({
        framework: "next",
        method: name as HttpMethod,
        line: fn.getStartLineNumber(),
      });
    }
  }
  return out;
}
```

- [ ] **Step 2: Run the test, confirm it passes**

Run: `cd .agent/tools && pnpm vitest run __tests__/routes.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add .agent/tools/routes.ts .agent/tools/__tests__/routes.test.ts .agent/tools/__tests__/fixtures/route-*.ts
git commit -m "feat(.agent/tools): detect mutating Fastify and Next App Router route handlers"
```

---

### Task 6: PlatformIngress reachability check (2-hop) — failing test

**Files:**
- Create: `.agent/tools/reachability.ts`
- Create: `.agent/tools/__tests__/reachability.test.ts`
- Create: `.agent/tools/__tests__/fixtures/reaches-ingress-direct.ts`
- Create: `.agent/tools/__tests__/fixtures/reaches-ingress-via-helper.ts`
- Create: `.agent/tools/__tests__/fixtures/reaches-ingress-helper.ts`
- Create: `.agent/tools/__tests__/fixtures/no-ingress.ts`

The reachability check is intentionally simple: scan the route file and any files it directly imports (one hop) for the symbol `PlatformIngress`. The spec accepts conservative + false-positive-prone behavior because the allowlist is the safety valve.

- [ ] **Step 1: Create fixtures**

`__tests__/fixtures/reaches-ingress-direct.ts`:

```ts
import { PlatformIngress } from "@switchboard/core";

export const handler = async () => {
  await PlatformIngress.submit({});
};
```

`__tests__/fixtures/reaches-ingress-helper.ts`:

```ts
import { PlatformIngress } from "@switchboard/core";

export async function submitViaHelper() {
  await PlatformIngress.submit({});
}
```

`__tests__/fixtures/reaches-ingress-via-helper.ts`:

```ts
import { submitViaHelper } from "./reaches-ingress-helper.js";

export const handler = async () => {
  await submitViaHelper();
};
```

`__tests__/fixtures/no-ingress.ts`:

```ts
export const handler = async () => {
  return { ok: true };
};
```

- [ ] **Step 2: Write the failing test**

`.agent/tools/__tests__/reachability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { reachesIngress } from "../reachability.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

function loadProject(): Project {
  return new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: false });
}

describe("reachesIngress", () => {
  it("returns true when route file references PlatformIngress directly", () => {
    const p = loadProject();
    const sf = p.addSourceFileAtPath(fixture("reaches-ingress-direct.ts"));
    expect(reachesIngress(sf)).toBe(true);
  });

  it("returns true when an imported helper file references PlatformIngress", () => {
    const p = loadProject();
    p.addSourceFileAtPath(fixture("reaches-ingress-helper.ts"));
    const sf = p.addSourceFileAtPath(fixture("reaches-ingress-via-helper.ts"));
    expect(reachesIngress(sf)).toBe(true);
  });

  it("returns false when neither the route nor any direct import references PlatformIngress", () => {
    const p = loadProject();
    const sf = p.addSourceFileAtPath(fixture("no-ingress.ts"));
    expect(reachesIngress(sf)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `cd .agent/tools && pnpm vitest run __tests__/reachability.test.ts`

Expected: FAIL — module not found.

---

### Task 7: Reachability — implementation

**Files:**
- Modify: `.agent/tools/reachability.ts`

- [ ] **Step 1: Implement `reachability.ts`**

```ts
import type { SourceFile } from "ts-morph";

const INGRESS_SYMBOL = "PlatformIngress";

export function reachesIngress(sf: SourceFile): boolean {
  if (fileMentions(sf, INGRESS_SYMBOL)) return true;

  // Hop 1: examine each file directly imported by sf.
  for (const importDecl of sf.getImportDeclarations()) {
    const imported = importDecl.getModuleSpecifierSourceFile();
    if (!imported) continue;
    if (fileMentions(imported, INGRESS_SYMBOL)) return true;
  }

  return false;
}

function fileMentions(sf: SourceFile, symbol: string): boolean {
  // Cheap, conservative: substring match on the file text.
  // The allowlist is the safety valve for the false positives this can produce.
  return sf.getFullText().includes(symbol);
}
```

- [ ] **Step 2: Run the test, confirm it passes**

Run: `cd .agent/tools && pnpm vitest run __tests__/reachability.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add .agent/tools/reachability.ts .agent/tools/__tests__/reachability.test.ts .agent/tools/__tests__/fixtures/reaches-* .agent/tools/__tests__/fixtures/no-ingress.ts
git commit -m "feat(.agent/tools): add 2-hop PlatformIngress reachability check"
```

---

### Task 8: Approval mutation detection — failing test

**Files:**
- Create: `.agent/tools/approval-mutations.ts`
- Create: `.agent/tools/__tests__/approval-mutations.test.ts`
- Create: `.agent/tools/__tests__/fixtures/approval-mutation.ts`
- Create: `.agent/tools/__tests__/fixtures/approval-readonly.ts`

- [ ] **Step 1: Create fixtures**

`__tests__/fixtures/approval-mutation.ts`:

```ts
export async function handler(ctx: { db: { approval: { create: (data: unknown) => Promise<void> } } }) {
  await ctx.db.approval.create({ status: "pending" });
}
```

`__tests__/fixtures/approval-readonly.ts`:

```ts
export async function handler(ctx: { db: { approval: { findFirst: () => Promise<unknown> } } }) {
  return ctx.db.approval.findFirst();
}
```

- [ ] **Step 2: Write the failing test**

`.agent/tools/__tests__/approval-mutations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findApprovalMutations } from "../approval-mutations.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

function project(): Project {
  return new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true });
}

describe("findApprovalMutations", () => {
  it("flags db.approval.create / update / delete calls", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("approval-mutation.ts"));
    const found = findApprovalMutations(sf);
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].method).toBe("create");
    expect(found[0].line).toBeGreaterThan(0);
  });

  it("ignores read-only approval queries (findFirst, findMany, get)", () => {
    const p = project();
    const sf = p.addSourceFileAtPath(fixture("approval-readonly.ts"));
    const found = findApprovalMutations(sf);
    expect(found).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

Run: `cd .agent/tools && pnpm vitest run __tests__/approval-mutations.test.ts`

Expected: FAIL — module not found.

---

### Task 9: Approval mutations — implementation

**Files:**
- Modify: `.agent/tools/approval-mutations.ts`

- [ ] **Step 1: Implement `approval-mutations.ts`**

```ts
import type { SourceFile, CallExpression } from "ts-morph";
import { SyntaxKind } from "ts-morph";

const MUTATING_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

export interface ApprovalMutation {
  method: string;
  line: number;
}

export function findApprovalMutations(sf: SourceFile): ApprovalMutation[] {
  const out: ApprovalMutation[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const method = propAccess.getName();
    if (!MUTATING_METHODS.has(method)) return;
    // Receiver should be `<x>.approval` or `<x>.approvals`.
    const receiver = propAccess.getExpression();
    if (receiver.getKind() !== SyntaxKind.PropertyAccessExpression) return;
    const receiverProp = receiver.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    if (receiverProp !== "approval" && receiverProp !== "approvals") return;
    out.push({ method, line: call.getStartLineNumber() });
  });
  return out;
}
```

- [ ] **Step 2: Run the test, confirm it passes**

Run: `cd .agent/tools && pnpm vitest run __tests__/approval-mutations.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add .agent/tools/approval-mutations.ts .agent/tools/__tests__/approval-mutations.test.ts .agent/tools/__tests__/fixtures/approval-*.ts
git commit -m "feat(.agent/tools): detect approval-state mutations in route handler files"
```

---

### Task 10: CLI assembly — failing test (synthetic-fixture acceptance test)

**Files:**
- Create: `.agent/tools/check-routes.ts`
- Create: `.agent/tools/route-allowlist.yaml` (initially empty list)
- Create: `.agent/tools/__tests__/check-routes.test.ts`
- Create: `.agent/tools/__tests__/fixtures/synthetic-violation/route.ts`
- Create: `.agent/tools/__tests__/fixtures/synthetic-clean/route.ts`

This task implements the spec's Acceptance Criterion 4: a synthetic broken fixture must produce a non-zero exit and a single `ingress` finding pointing at the right line.

- [ ] **Step 1: Create the synthetic fixtures**

`__tests__/fixtures/synthetic-violation/route.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";

export const violationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/widgets", async (req, reply) => {
    return reply.code(201).send({ ok: true });
  });
};
```

`__tests__/fixtures/synthetic-clean/route.ts`:

```ts
import type { FastifyPluginAsync } from "fastify";
import { PlatformIngress } from "@switchboard/core";

export const cleanRoutes: FastifyPluginAsync = async (app) => {
  app.post("/widgets", async (req, reply) => {
    await PlatformIngress.submit({});
    return reply.code(201).send({ ok: true });
  });
};
```

- [ ] **Step 2: Create the empty allowlist**

`.agent/tools/route-allowlist.yaml`:

```yaml
# Route ingress-check allowlist.
# Each entry exempts ONE route path glob from the PlatformIngress.submit requirement.
# Adding an entry requires a one-line reason. PR review enforces the bar.
# Globs are matched against the repo-relative file path.

# (intentionally empty — populated in Task 14 after running against main)
```

ts-morph requires a non-empty parse target, but yaml's `parse()` returns `null` for a comment-only file, which our loader treats as an error. To make the empty case work cleanly, write `[]` instead:

`.agent/tools/route-allowlist.yaml`:

```yaml
# Route ingress-check allowlist.
# Each entry exempts ONE route path glob from the PlatformIngress.submit requirement.
# Adding an entry requires a one-line reason. PR review enforces the bar.
# Globs are matched against the repo-relative file path.
[]
```

- [ ] **Step 3: Write the failing test**

`.agent/tools/__tests__/check-routes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { runCheckRoutes } from "../check-routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", ".."); // .agent/tools/__tests__ -> repo root

describe("runCheckRoutes (CLI integration)", () => {
  it("synthetic violation: reports one ingress finding and exits non-zero", async () => {
    const result = await runCheckRoutes({
      includePaths: [join(here, "fixtures/synthetic-violation/**/*.ts")],
      allowlistPath: join(here, "fixtures/empty-allowlist.yaml"),
      repoRoot,
    });
    expect(result.exitCode).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe("ingress");
    expect(result.findings[0].line).toBeGreaterThan(0);
  });

  it("synthetic clean: no findings, exits zero", async () => {
    const result = await runCheckRoutes({
      includePaths: [join(here, "fixtures/synthetic-clean/**/*.ts")],
      allowlistPath: join(here, "fixtures/empty-allowlist.yaml"),
      repoRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("allowlist suppresses findings and reports the count", async () => {
    const result = await runCheckRoutes({
      includePaths: [join(here, "fixtures/synthetic-violation/**/*.ts")],
      allowlistPath: join(here, "fixtures/violation-allowlisted.yaml"),
      repoRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(0);
    expect(result.suppressedCount).toBeGreaterThanOrEqual(1);
  });
});
```

Create supporting fixtures:

`__tests__/fixtures/empty-allowlist.yaml`:

```yaml
[]
```

`__tests__/fixtures/violation-allowlisted.yaml`:

```yaml
- path: "**/synthetic-violation/**"
  reason: Synthetic test fixture for the check-routes tool itself.
```

- [ ] **Step 4: Run the test, confirm it fails**

Run: `cd .agent/tools && pnpm vitest run __tests__/check-routes.test.ts`

Expected: FAIL — `runCheckRoutes` not exported.

---

### Task 11: CLI assembly — implementation

**Files:**
- Modify: `.agent/tools/check-routes.ts`

- [ ] **Step 1: Implement `check-routes.ts`**

```ts
#!/usr/bin/env tsx
import { Project, SourceFile } from "ts-morph";
import { resolve, relative } from "path";
import { glob } from "glob";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { findMutatingRouteHandlers } from "./routes.js";
import { reachesIngress } from "./reachability.js";
import { findApprovalMutations } from "./approval-mutations.js";
import { loadAllowlist, isAllowlisted, type AllowlistEntry } from "./allowlist.js";

export type FindingKind = "ingress" | "approval";

export interface Finding {
  path: string; // repo-relative
  line: number;
  kind: FindingKind;
  message: string;
}

export interface RunOptions {
  includePaths: string[]; // glob patterns (absolute or relative to cwd)
  allowlistPath: string;
  repoRoot: string;
}

export interface RunResult {
  findings: Finding[];
  suppressedCount: number;
  exitCode: number;
}

export async function runCheckRoutes(opts: RunOptions): Promise<RunResult> {
  const allowlist = loadAllowlist(opts.allowlistPath);

  const files = (
    await Promise.all(opts.includePaths.map((p) => glob(p, { absolute: true, nodir: true })))
  ).flat();

  const project = new Project({ useInMemoryFileSystem: false });
  const sources: SourceFile[] = files
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => project.addSourceFileAtPath(f));

  const raw: Finding[] = [];

  for (const sf of sources) {
    const repoPath = relative(opts.repoRoot, sf.getFilePath());
    const handlers = findMutatingRouteHandlers(sf);
    if (handlers.length > 0 && !reachesIngress(sf)) {
      // One ingress finding per file (not per handler) — points at the first handler line.
      raw.push({
        path: repoPath,
        line: handlers[0].line,
        kind: "ingress",
        message: "mutating route handler does not reach PlatformIngress.submit",
      });
    }
    for (const m of findApprovalMutations(sf)) {
      raw.push({
        path: repoPath,
        line: m.line,
        kind: "approval",
        message: `direct write to approval state in route handler (${m.method})`,
      });
    }
  }

  const { kept, suppressed } = partitionByAllowlist(raw, allowlist);

  return {
    findings: kept,
    suppressedCount: suppressed.length,
    exitCode: kept.length === 0 ? 0 : 1,
  };
}

function partitionByAllowlist(
  findings: Finding[],
  allowlist: AllowlistEntry[],
): { kept: Finding[]; suppressed: Finding[] } {
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  for (const f of findings) {
    if (isAllowlisted(f.path, allowlist)) suppressed.push(f);
    else kept.push(f);
  }
  return { kept, suppressed };
}

export function formatFinding(f: Finding): string {
  return `${f.path}:${f.line}: ${f.kind} — ${f.message}`;
}

// CLI entry point — only executed when run directly, not when imported by tests.
const isMain = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..", "..");
  const result = await runCheckRoutes({
    includePaths: [
      join(repoRoot, "apps/api/src/routes/**/*.ts"),
      join(repoRoot, "apps/chat/src/routes/**/*.ts"),
      join(repoRoot, "apps/dashboard/src/app/api/**/route.ts"),
      join(repoRoot, "apps/dashboard/src/app/api/**/route.tsx"),
    ],
    allowlistPath: join(here, "route-allowlist.yaml"),
    repoRoot,
  });

  for (const f of result.findings) console.log(formatFinding(f));
  if (result.suppressedCount > 0) {
    console.log(`\n${result.suppressedCount} findings suppressed by allowlist.`);
  }
  process.exit(result.exitCode);
}
```

- [ ] **Step 2: Add `glob` dependency**

```bash
cd .agent/tools && pnpm add --ignore-workspace glob @types/glob
```

- [ ] **Step 3: Run the test, confirm it passes**

Run: `cd .agent/tools && pnpm vitest run __tests__/check-routes.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 4: Run all tool tests**

Run: `cd .agent/tools && pnpm test`

Expected: All tests pass — allowlist (4), routes (4), reachability (3), approval-mutations (2), check-routes (3) = 16 tests.

- [ ] **Step 5: Commit**

```bash
git add .agent/tools/check-routes.ts .agent/tools/route-allowlist.yaml .agent/tools/__tests__/check-routes.test.ts .agent/tools/__tests__/fixtures/synthetic-* .agent/tools/__tests__/fixtures/empty-allowlist.yaml .agent/tools/__tests__/fixtures/violation-allowlisted.yaml .agent/tools/package.json .agent/tools/pnpm-lock.yaml
git commit -m "feat(.agent/tools): wire route audit CLI with allowlist filtering and exit codes"
```

---

### Task 12: Shell wrapper

**Files:**
- Create: `.agent/tools/check-routes` (executable)

- [ ] **Step 1: Write the wrapper**

`.agent/tools/check-routes`:

```sh
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
if [ ! -d node_modules ]; then
  echo "Installing .agent/tools dependencies..." >&2
  pnpm install --ignore-workspace --silent
fi
exec ./node_modules/.bin/tsx check-routes.ts "$@"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x .agent/tools/check-routes`

- [ ] **Step 3: Verify it runs**

Run: `.agent/tools/check-routes; echo "exit=$?"`

Expected: prints findings (probably some — that's fine, we'll triage in Task 14) and an `exit=0` or `exit=1`. The point of this step is just confirming the wrapper invokes `tsx` correctly. Don't fix findings yet.

- [ ] **Step 4: Commit**

```bash
git add .agent/tools/check-routes
git commit -m "feat(.agent/tools): add executable shell wrapper for check-routes"
```

---

### Task 13: Tools README

**Files:**
- Create: `.agent/tools/README.md`

- [ ] **Step 1: Write the README**

`.agent/tools/README.md`:

```markdown
# .agent/tools

Deterministic, idempotent scripts that audit the codebase. The agent operating layer calls these from skills before reasoning, so an LLM is not asked to do work a script can answer.

## What lives here

TypeScript programs (run via `tsx`) and their data files (allowlists, fixtures). Not part of the pnpm workspace — installed standalone with `--ignore-workspace`. `.agent/` is the agent operating layer, not product code.

## Deterministic before latent

When a check can be expressed as a script — grep, AST query, type assertion, fixture comparison — write the script. Reserve LLM reasoning in skills for judgment calls that scripts genuinely cannot make. Skills should call the relevant tool first and reason on its output, not the other way around.

## Output format

Machine-grep-friendly, one line per finding:

```
<repo-relative-path>:<line>: <kind> — <message>
```

Tools exit non-zero on findings, zero on a clean run. Allowlisted findings are suppressed and summarized at the end (`N findings suppressed by allowlist.`) so the allowlist's blast radius is visible.

## Invocation

Each tool is callable directly by path:

```
.agent/tools/check-routes
```

The shell wrapper handles dependency install on first run. To run the test suite:

```
cd .agent/tools && pnpm test
```

## Adding a new tool

1. Add a TypeScript file in `.agent/tools/`.
2. Add a script entry in the local `package.json`.
3. Add a sibling shell wrapper if the tool will be invoked from skills.
4. If the check needs an allowlist, add a sibling YAML file (`<tool>-allowlist.yaml`) with required `path:` and `reason:` keys per entry. Adding an entry requires a non-empty `reason`.
5. Wire the tool into the relevant skill's "Run first" block and the resolver's load list.

## Current tools

- `check-routes` — flags mutating Fastify and Next App Router route handlers that don't reach `PlatformIngress.submit`, plus direct approval-state mutations in route files. Allowlist: `route-allowlist.yaml`.
```

- [ ] **Step 2: Commit**

```bash
git add .agent/tools/README.md
git commit -m "docs(.agent/tools): document tools directory contract and deterministic-before-latent principle"
```

---

### Task 14: Run against `main`, populate the allowlist

**Files:**
- Modify: `.agent/tools/route-allowlist.yaml`

- [ ] **Step 1: Run the tool against the repo**

Run: `.agent/tools/check-routes`

Capture the output. Expected: a list of `path:line: ingress — ...` and `path:line: approval — ...` findings, exit code 1.

- [ ] **Step 2: Triage every finding**

For each finding:

- **Real architecture violation** — file should reach `PlatformIngress.submit` but doesn't. Stop and surface it; the user must decide whether to fix the code or accept it as a known issue. Do not silently allowlist real violations.
- **Legitimate exception** — auth/session, health/setup, approval-lifecycle response (uses `PlatformLifecycle`), test fixtures. Add a glob to `route-allowlist.yaml` with a one-line reason.

Allowlist categories to seed (only add entries that actually match real findings — do not add speculative globs):

```yaml
- path: apps/api/src/routes/auth/**/*.ts
  reason: Auth/session handlers — not business-state mutations.

- path: apps/api/src/routes/health.ts
  reason: Health check — no business state.

- path: apps/api/src/routes/setup/**/*.ts
  reason: Onboarding setup — pre-platform-ingress lifecycle.

- path: apps/api/src/routes/approvals.ts
  reason: Approval response — correctly uses ApprovalLifecycleService, not PlatformIngress.

- path: "**/*.test.ts"
  reason: Test fixtures and mocks.

- path: "**/*.fixture.ts"
  reason: Test fixtures and mocks.
```

Add only the entries that actually suppress real findings on the current `main`. Each entry must include a `reason` field.

- [ ] **Step 3: Re-run the tool**

Run: `.agent/tools/check-routes; echo "exit=$?"`

Expected: `exit=0` and a `N findings suppressed by allowlist.` line. If `exit=1`, there are unsuppressed findings — repeat Step 2. If a finding cannot be allowlisted in good conscience, stop and surface it to the user as a real architecture issue.

- [ ] **Step 4: Commit the populated allowlist**

```bash
git add .agent/tools/route-allowlist.yaml
git commit -m "chore(.agent/tools): seed route-allowlist.yaml from current main"
```

---

### Task 15: Architecture-audit skill — additive edits

**Files:**
- Modify: `.agent/skills/architecture-audit/SKILL.md`

- [ ] **Step 1: Add a "Run first" block at the top of the skill**

Open `.agent/skills/architecture-audit/SKILL.md`. After the `## Purpose` section and before `## Use when`, insert a new section:

```markdown
## Run first

Before reasoning, run:

```
.agent/tools/check-routes
```

Treat each output line as a starting candidate for the audit. Lines reported as `N findings suppressed by allowlist` are intentionally exempted — do not reason about them unless explicitly asked.
```

- [ ] **Step 2: Add an "Approval lifecycle deep trace" section**

After the `## Process` section and before `## Output`, insert:

```markdown
## Approval lifecycle deep trace

When `check-routes` reports an `approval` finding, perform this deeper trace before classifying:

1. Trace the call site upward. Does the mutation originate inside the route handler, or is the route only forwarding into `ApprovalLifecycleService`? Forwarding is fine; in-route mutation is a violation.
2. For each create / resolve path, confirm the corresponding `WorkTrace` write exists.
3. For each path, confirm a test exercises the full request → resolve → side effect chain, not just the route handler.

This replaces the previously proposed standalone `approval-lifecycle-audit` skill — it is a section of architecture-audit, not a separate route.
```

- [ ] **Step 3: Verify the skill still reads cleanly**

Run: `cat .agent/skills/architecture-audit/SKILL.md | head -30`

Expected: `# Skill: Architecture Audit`, then `## Purpose`, then `## Run first`, then `## Use when` — the new section is in the right place.

- [ ] **Step 4: Commit**

```bash
git add .agent/skills/architecture-audit/SKILL.md
git commit -m "docs(.agent/skills): wire check-routes into architecture-audit; add approval deep-trace section"
```

---

### Task 16: RESOLVER.md — add `Run first` block; resolver-eval entry

**Files:**
- Modify: `.agent/RESOLVER.md`
- Modify: `.agent/evals/resolver-evals.json`

- [ ] **Step 1: Update the Architecture audit route**

Edit `.agent/RESOLVER.md`. The existing route looks like:

```markdown
## Architecture audit

**Triggers:** PlatformIngress, WorkTrace, lifecycle state machine, mutating surface, runtime convergence, bypass path, canonical request

**Load:**

- `docs/DOCTRINE.md`
- ...
```

Insert a `Run first:` block between Triggers and Load:

```markdown
## Architecture audit

**Triggers:** PlatformIngress, WorkTrace, lifecycle state machine, mutating surface, runtime convergence, bypass path, canonical request

**Run first:**

- `.agent/tools/check-routes`

**Load:**

- `docs/DOCTRINE.md`
- ...
```

(Leave the rest of the route unchanged.)

- [ ] **Step 2: Add a resolver-eval entry that should route to architecture-audit**

Read the existing format:

Run: `cat .agent/evals/resolver-evals.json | head -40`

Add one new entry to the JSON array that matches the architecture-audit triggers — for example:

```json
{
  "prompt": "Audit whether the new approvals respond route bypasses PlatformIngress and check the lifecycle state machine.",
  "expectedRoute": "Architecture audit"
}
```

(Match the existing schema — if the field is `expected` instead of `expectedRoute`, use that. Match the case used by other entries.)

- [ ] **Step 3: Commit**

```bash
git add .agent/RESOLVER.md .agent/evals/resolver-evals.json
git commit -m "docs(.agent): wire check-routes into architecture-audit resolver route"
```

---

### Task 17: Final verification + implementation report

**Files:** none (verification only)

- [ ] **Step 1: Run the full tool test suite**

Run: `cd .agent/tools && pnpm test`

Expected: all 16 tests pass.

- [ ] **Step 2: Run the tool against `main`**

Run: `.agent/tools/check-routes; echo "exit=$?"`

Expected: `exit=0`, with an `N findings suppressed by allowlist.` line.

- [ ] **Step 3: Acceptance check 4 — synthetic violation**

Run:

```bash
cd .agent/tools && pnpm vitest run __tests__/check-routes.test.ts -t "synthetic violation"
```

Expected: PASS — the synthetic-violation fixture produces exit code 1 with one `ingress` finding.

- [ ] **Step 4: Acceptance check 5 — missing reason fails loudly**

Run:

```bash
cd .agent/tools && pnpm vitest run __tests__/allowlist.test.ts -t "missing a reason"
```

Expected: PASS — the loader throws on missing reason.

- [ ] **Step 5: Run repo-wide checks**

Run: `pnpm typecheck`

Expected: PASS (no changes to product code, so this should be unaffected).

Run: `pnpm lint`

Expected: PASS or unchanged warning count. `.agent/tools/` is outside the workspace and should not be linted by the root config — confirm with `pnpm lint 2>&1 | grep -c "\.agent/tools"` returning `0`.

- [ ] **Step 6: Write the implementation report**

Append to the spec document at `docs/superpowers/specs/2026-04-26-agent-operating-layer-phase3-design.md` under the "Implementation Report" section:

1. Files created or changed (full list with line counts via `git diff --stat main...HEAD`).
2. The exact `RESOLVER.md` diff (`git diff main -- .agent/RESOLVER.md`).
3. Sample output from `.agent/tools/check-routes` against current `main` — paste 5-10 representative lines and the suppressed-count summary.
4. Final contents of `route-allowlist.yaml` — every entry called out with its reason.
5. Result of the synthetic-fixture acceptance test (Acceptance Criterion 4).

Commit:

```bash
git add docs/superpowers/specs/2026-04-26-agent-operating-layer-phase3-design.md
git commit -m "docs(spec): fill in phase 3 implementation report"
```

- [ ] **Step 7: Stop and surface to the user**

Do not open a PR or merge. Report completion to the user with:

- Summary of all commits on the branch
- Sample tool output
- Allowlist contents

User reviews and decides next step.

---

## Self-Review

**Spec coverage:**
- Section 1 (`check-routes.ts`) → Tasks 4-11.
- Section 2 (`route-allowlist.yaml`) → Tasks 2-3, 14.
- Section 3 (`tools/README.md`) → Task 13.
- Section 4 (architecture-audit edits) → Task 15.
- Section 5 (RESOLVER.md edits) → Task 16.
- Acceptance Criterion 1 (runs against main) → Task 14, 17.
- Acceptance Criterion 2 (exit 0 after allowlist) → Task 14 Step 3, Task 17 Step 2.
- Acceptance Criterion 3 (architecture-audit references tool) → Task 15, 16.
- Acceptance Criterion 4 (synthetic violation) → Task 10, 17 Step 3.
- Acceptance Criterion 5 (missing reason fails loudly) → Task 3, 17 Step 4.
- Implementation Report → Task 17 Step 6.

**Placeholder scan:** No `TBD`, `TODO`, or "fill in details." Every code step shows the code. Every test step shows the test.

**Type consistency:** `RouteHandler.framework`, `Finding.kind`, `AllowlistEntry.path`/`reason` — all defined in their introducing tasks (5, 7, 11, 3) and referenced consistently downstream. `runCheckRoutes` signature in Task 11 matches the test expectations in Task 10.

**Known scope cut documented in plan:** MCP route detection (`apps/mcp-server`) is out of scope for this phase — Fastify (`apps/api`, `apps/chat`) and Next App Router (`apps/dashboard`) only. The spec listed MCP, but the tool-call shape is sufficiently different that bundling it would balloon Tasks 4-5. If MCP coverage is needed, it earns its own task in a future phase.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-26-agent-operating-layer-phase3.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
