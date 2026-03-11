# refactor-reviewer — Anti-Spaghetti + Anti-Over-Engineering

## Description
Reviews refactoring decisions to prevent both under-engineering (spaghetti code) and over-engineering (premature abstractions). Ensures code lands in the right architectural layer.

## When to Use
Activate this skill when:
- Refactoring, extracting, or reorganizing code
- Creating new abstractions, utilities, or shared modules
- Moving code between packages or files
- Deciding whether to split a large file

## Instructions

### Anti-Spaghetti Rules
When extracting code to a new file:
1. The new file must have a **single clear responsibility** — name should describe what it does
2. **Never** create a `utils.ts` grab-bag — each utility gets its own file or belongs in an existing focused module
3. Extracted functions should have clear input/output contracts (typed parameters and return types)
4. If the extraction creates a dependency from a higher layer to a lower one, stop and reconsider

### Anti-Over-Engineering Rules
1. **Don't create abstractions for things used in only 1 place** — inline is fine
2. **Three similar lines of code is better than a premature abstraction** — wait for the third use before extracting
3. **Don't add feature flags or configurability** unless explicitly requested
4. **Don't create a new package** when a directory in an existing package would suffice
5. **Don't add generics** unless there are at least 2 concrete types that use them

### Right-Sizing Check
If a refactor creates:
- **More than 3 new files** → justify each one; consider if some can be combined
- **A new package** → justify why it can't be a directory in an existing package
- **A new abstraction layer** → justify with at least 3 concrete consumers

### Layer Placement Validation
Before moving/creating code, verify it goes to the right layer:
- **Pure types and Zod schemas** → `packages/schemas`
- **Cartridge interfaces and base classes** → `packages/cartridge-sdk`
- **Orchestration, policy, tool registry** → `packages/core`
- **Domain-specific business logic** → `cartridges/<domain>`
- **Persistence and data access** → `packages/db`
- **HTTP/webhook/protocol handlers** → `apps/*`

### Duplication Audit
Before creating any new utility:
1. Search `packages/cartridge-sdk/src/` — check `result-helpers.ts`, `base-cartridge.ts`
2. Search `packages/core/src/` — check for existing orchestrator utilities
3. Search `packages/schemas/src/` — check for existing type utilities
4. If a similar function exists elsewhere, use it or extend it instead
