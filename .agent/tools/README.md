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
