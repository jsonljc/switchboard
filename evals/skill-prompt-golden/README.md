# skill-prompt-golden

Golden prompt-diff gate for the vertical-pack extraction. Byte-snapshots the
fully-assembled **medspa** system prompt (skeleton + spliced pack blocks +
injected slots + governance tail) so that any refactor which is meant to be
behavior-preserving for medspa is proven so: ZERO snapshot diff is the merge
gate for every pack slice (skeleton split, loader re-key, provisioning, the L1
open-profile refactor).

## What it does

For each fixture (`fixtures.ts`) it runs the real production render path
(`render.ts`): `loadSkill("alex")` -> `resolveParameters` (persona + alexBuilder

- ContextResolver over the file-stub medspa context) -> `buildSystemPrompt`, then
  asserts the output against a committed snapshot in `snapshots/`.

`CURRENT_DATETIME` is pinned (alexBuilder injects wall-clock otherwise); the run
is **model-free and DB-free** (no `ANTHROPIC_API_KEY`, no Postgres), so it runs
in the free CI path via `evals/vitest.config.ts`.

## Run

```bash
pnpm exec vitest run --config evals/vitest.config.ts skill-prompt-golden
```

## Updating snapshots (deliberate)

Only when a prompt change is intended. Regenerate and review the diff before
committing:

```bash
pnpm exec vitest run --config evals/vitest.config.ts skill-prompt-golden -u
```

A snapshot diff on an unrelated change means the refactor was NOT
behavior-preserving for medspa. Do not blindly `-u`; read the diff first.
