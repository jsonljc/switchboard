# Knowledge/Context Layer — SP5 Design

**Date:** 2026-04-16
**Status:** Draft
**Governing sentence:** SP5 gives skills scoped, curated knowledge so each agent gets the right playbooks, policies, and domain guidance — and only what it needs.

---

## Problem

Switchboard skills currently run with zero curated knowledge. The only injected context is:

- **Runtime state** via `ParameterBuilder` (lead profile, pipeline stage, persona config)
- **Eight hardcoded governance lines** via `governance-injector.ts`
- **Operational memory** via `DeploymentMemory` (learned facts, objections, patterns)

What's missing is **durable, curated guidance**: objection handling playbooks, messaging policies, offer catalogs, qualification frameworks, nurture cadences. Without this, skills rely entirely on the LLM's general knowledge and whatever the persona config provides inline. That makes every skill mediocre at the things that should be its sharpest edge — domain-specific judgment.

## Design Principles

1. **Skills declare what knowledge they need** — explicit context contracts in frontmatter, not implicit global loading
2. **Knowledge is org-scoped and versioned** — different orgs get different playbooks, with audit-friendly version history
3. **Durable knowledge is separate from operational memory** — playbooks/policies/catalogs in `KnowledgeEntry`, volatile facts/patterns in `DeploymentMemory`
4. **Named injection, not blob injection** — each knowledge category gets its own template variable (`{{PLAYBOOK_CONTEXT}}`, `{{POLICY_CONTEXT}}`), not one giant `{{CONTEXT}}` block
5. **Fail-fast on missing required knowledge** — deterministic setup error, not fuzzy model-time failure

---

## Section 1: Data Model

### Prisma Schema

```prisma
enum KnowledgeKind {
  playbook
  policy
  knowledge
}

model KnowledgeEntry {
  id             String        @id @default(cuid())
  organizationId String
  kind           KnowledgeKind
  scope          String        // kebab-case, e.g. "objection-handling", "offer-catalog"
  title          String
  content        String        @db.Text
  version        Int           @default(1)
  active         Boolean       @default(true)
  priority       Int           @default(0)  // higher wins in merge conflicts
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@unique([organizationId, kind, scope, version])
  @@index([organizationId, kind, scope, active])
}
```

### Zod Schema (`packages/schemas/src/knowledge.ts`)

```typescript
import { z } from "zod";

export const KnowledgeKindSchema = z.enum(["playbook", "policy", "knowledge"]);
export type KnowledgeKind = z.infer<typeof KnowledgeKindSchema>;

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const KnowledgeEntryCreateSchema = z.object({
  organizationId: z.string().min(1),
  kind: KnowledgeKindSchema,
  scope: z.string().regex(KEBAB_CASE, "Scope must be lowercase kebab-case"),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1, "Content must not be blank"),
  priority: z.number().int().min(0).default(0),
});

export const KnowledgeEntryUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1, "Content must not be blank").optional(),
  priority: z.number().int().min(0).optional(),
});

export const KnowledgeEntrySchema = KnowledgeEntryCreateSchema.extend({
  id: z.string().min(1),
  version: z.number().int().positive(),
  active: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;
```

### Key Decisions

- **`kind` is an enum, not a string** — prevents typos like "playbok" in foundational data
- **`scope` enforced kebab-case** — `objection-handling`, not `ObjectionHandling` or `objection_handling`
- **`content` validated non-empty at write-time** — blank entries never reach the resolver
- **`priority`** — deterministic merge ordering when multiple entries match. Tie-break: `priority DESC, updatedAt DESC`
- **`version` + `active`** — append-only versioning. Updates create a new row and deactivate the predecessor. No hard deletes.
- **No freshness/expiry** — freshness is an operational memory concept (`DeploymentMemory`). Playbooks and policies don't expire; they're versioned.
- **Multiple active entries for same kind+scope** — allowed but should be rare and intentional. Use for modular composition (e.g., two complementary objection-handling playbooks), not as a substitute for disciplined versioning.

---

## Section 2: Context Contract Format

Skills declare knowledge requirements in frontmatter via a `context` block:

```yaml
context:
  - kind: playbook
    scope: objection-handling
    inject_as: PLAYBOOK_CONTEXT
  - kind: policy
    scope: messaging-rules
    inject_as: POLICY_CONTEXT
  - kind: knowledge
    scope: offer-catalog
    inject_as: KNOWLEDGE_CONTEXT
    required: false
```

### Schema

```typescript
const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/;

export const ContextRequirementSchema = z.object({
  kind: KnowledgeKindSchema,
  scope: z.string().regex(KEBAB_CASE),
  injectAs: z.string().regex(SCREAMING_SNAKE), // YAML: inject_as, normalized to camelCase by loader
  required: z.boolean().default(true),
});
export type ContextRequirement = z.infer<typeof ContextRequirementSchema>;
```

### Resolution Rules

1. `SkillLoader` parses and validates the `context` block alongside `parameters` and `tools`
2. **Duplicate `injectAs` values within one skill are invalid** — rejected at load-time with a clear error
3. `inject_as` (YAML snake_case) is normalized to `injectAs` (TypeScript camelCase) during loading
4. `required: true` (default) means missing knowledge fails execution before the LLM call
5. Missing optional vars interpolate to empty string via template engine fallback

### What This Preserves

- `DeploymentMemory` stays separate — operational memory is not curated knowledge
- `ParameterBuilder` continues to resolve runtime state only — curated knowledge resolution is a separate step in handler assembly
- `governance-injector.ts` stays as-is for v1 — migrating hardcoded constraints to `kind: policy` entries is a follow-up

---

## Section 3: ContextResolver

A new module: `packages/core/src/skill-runtime/context-resolver.ts`

**Single responsibility:** given a skill's context declarations and an orgId, fetch and assemble resolved context variables.

### Interface

```typescript
interface ResolvedContext {
  variables: Record<string, string>;
  metadata: ContextResolutionMeta[];
}

interface ContextResolutionMeta {
  injectAs: string;
  kind: KnowledgeKind;
  scope: string;
  entriesFound: number;
  totalChars: number;
}

interface ContextResolver {
  resolve(orgId: string, requirements: ContextRequirement[]): Promise<ResolvedContext>;
}
```

### Resolution Logic

1. **Batch-fetch** all matching entries in one query: `WHERE orgId = ? AND (kind, scope) IN [...] AND active = true`
2. **Group** fetched entries by `(kind, scope)`, then assemble each declared `injectAs` variable from its matched group
3. **Within each group:** sort `priority DESC, updatedAt DESC`, concatenate with `\n---\n`
4. **Required check:** `required: true` groups with zero entries throw `ContextResolutionError` (fails before LLM call)
5. **Optional handling:** groups with zero entries are omitted from `variables` (template engine interpolates missing optional vars to empty string)

### What This Does NOT Do

- No caching (v1 hits the DB every execution — knowledge changes are infrequent, query is indexed)
- No cross-org inheritance or fallback chains
- No LLM-based summarization or compression
- No freshness/expiry logic

---

## Section 4: Knowledge Management

### Store (`packages/db/src/stores/prisma-knowledge-entry-store.ts`)

```typescript
interface KnowledgeEntryStore {
  findActive(
    orgId: string,
    filters: Array<{ kind: KnowledgeKind; scope: string }>,
  ): Promise<KnowledgeEntry[]>;

  create(entry: KnowledgeEntryCreate): Promise<KnowledgeEntry>;
  update(id: string, orgId: string, data: KnowledgeEntryUpdate): Promise<KnowledgeEntry>;
  deactivate(id: string, orgId: string): Promise<void>;
  list(
    orgId: string,
    filters?: { kind?: KnowledgeKind; scope?: string },
  ): Promise<KnowledgeEntry[]>;
}
```

- `create` validates via `KnowledgeEntryCreateSchema` (content non-empty, scope kebab-case)
- `update` always creates a full new row (all fields copied, changed fields overwritten) with bumped version, then deactivates the specific predecessor. Partial updates (e.g., only changing `title`) still produce a complete new version — this is append-only, not in-place.
- `deactivate` sets `active = false` — no hard deletes
- All methods scope by `orgId` — no cross-org access

### API Routes (`apps/api/src/routes/knowledge.ts`)

```
GET    /api/orgs/:orgId/knowledge              — list, optional ?kind=&scope= filters
GET    /api/orgs/:orgId/knowledge/:id           — get single entry
POST   /api/orgs/:orgId/knowledge               — create new entry
PATCH  /api/orgs/:orgId/knowledge/:id           — update (creates new version)
DELETE /api/orgs/:orgId/knowledge/:id           — deactivate (soft delete)
```

Standard org-scoped auth via existing middleware. No new auth patterns.

### Seeds (`packages/db/src/seeds/knowledge-seeds.ts`)

Default entries for the demo org so skills work out of the box:

| Kind      | Scope                   | Title                                |
| --------- | ----------------------- | ------------------------------------ |
| playbook  | objection-handling      | Standard objection handling patterns |
| policy    | messaging-rules         | Default messaging policy             |
| knowledge | offer-catalog           | Demo service catalog                 |
| playbook  | qualification-framework | Lead qualification playbook          |
| playbook  | nurture-cadence         | Re-engagement playbook               |

Minimum set for `sales-pipeline.md`. Other skills add their own seeds when they adopt context declarations.

### What This Does NOT Include

- No bulk import/export
- No dashboard UI (API-first for now)
- No approval workflow for knowledge changes (org admins manage directly)
- No knowledge templates or marketplace-shared knowledge

---

## Section 5: Wiring

### Modified Files

1. **`skill-loader.ts`** — parse `context` block from frontmatter, validate via `ContextRequirementSchema`, reject duplicate `injectAs` at load-time, normalize `inject_as` → `injectAs`

2. **`skill-handler.ts`** — add `ContextResolver` dependency, call between parameter resolution and execution:

```typescript
// Current flow:
const params = await builder(ctx, config, stores);
const result = await executor.execute({ skill, parameters: params, ... });

// New flow:
const params = await builder(ctx, config, stores);
const resolved = await contextResolver.resolve(config.orgId, skill.context);
const mergedScope = { ...params, ...resolved.variables };
const result = await executor.execute({ skill, parameters: mergedScope, ... });
```

3. **`batch-skill-handler.ts`** — resolve context after `BatchParameterBuilder` returns, merge `resolved.variables` into the builder's output before passing to the executor. The injection point differs from `SkillHandler` (builder is a callback, not a separate step), but the merge logic is identical: `{ ...builderOutput, ...resolved.variables }`

4. **`skill-executor.ts`** — no changes. Already interpolates `parameters` into template. Context variables arrive as additional parameters.

5. **`types.ts`** — add `context` field to `SkillDefinition`:

```typescript
interface SkillDefinition {
  // ... existing fields
  context: ContextRequirement[]; // empty array if no context declared
}
```

6. **Bootstrap** (`apps/api/src/bootstrap/`) — wire `PrismaKnowledgeEntryStore` into dependency graph, inject into `ContextResolver`, pass resolver to skill handlers

### Execution Trace Integration

Add `contextResolution` to `SkillExecutionTrace`:

```typescript
interface SkillExecutionTrace {
  // ... existing fields
  contextResolution: ContextResolutionMeta[];
}
```

The existing execution trace table has a `metadata` JSON column — `contextResolution` is serialized into it alongside existing trace data. No additional migration needed beyond the `KnowledgeEntry` table.

### Backward Compatibility

- Skills with no `context` block: **zero changes**. `skill.context` defaults to `[]`, resolver returns empty variables, merge is a no-op.
- `sales-pipeline.md` gets a `context` block and template updates to reference `{{PLAYBOOK_CONTEXT}}`, `{{POLICY_CONTEXT}}`, etc.
- `website-profiler.md` and `ad-optimizer.md` can adopt context declarations independently — not required for SP5.

### Migration

One Prisma migration adding the `KnowledgeEntry` table + `KnowledgeKind` enum. No changes to existing tables.

---

## Testing Strategy

| Test                                   | Location                                     | Validates                                                                                                        |
| -------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `context-resolver.test.ts`             | `packages/core/src/skill-runtime/__tests__/` | Resolution ordering, required failures, empty optional handling, duplicate injectAs rejection, metadata assembly |
| `skill-loader.test.ts` (extend)        | `packages/core/src/skill-runtime/__tests__/` | Context block parsing, validation, snake_case normalization, duplicate injectAs load-time rejection              |
| `skill-handler.test.ts` (extend)       | `packages/core/src/skill-runtime/__tests__/` | End-to-end: context resolution → parameter merge → execution                                                     |
| `prisma-knowledge-entry-store.test.ts` | `packages/db/src/stores/__tests__/`          | CRUD, append-only versioning, deactivation, findActive filtering, priority ordering                              |
| `knowledge.test.ts`                    | `apps/api/src/routes/__tests__/`             | API routes, org scoping, auth, validation errors                                                                 |

---

## What SP5 Does NOT Do

- Build a knowledge marketplace
- Add a dashboard UI for knowledge editing
- Implement cross-org knowledge inheritance
- Add LLM-based summarization or compression of knowledge
- Migrate `governance-injector.ts` constraints to `KnowledgeEntry`
- Add freshness/expiry to knowledge (that's `DeploymentMemory`'s domain)
- Build bulk import/export
- Add approval workflows for knowledge changes
- Cache resolved knowledge (indexed query is fast enough for v1)
