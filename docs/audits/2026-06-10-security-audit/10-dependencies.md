# Audit 8 — Dependency Vulnerabilities

_Question: do `pnpm audit` / the lockfile show anything dangerous? Read-only._

## The numbers

`pnpm audit`: **14 advisories — 2 critical (1 explicitly suppressed), 11 moderate, 1 low.**

## What they are and where they live

The key question isn't the count, it's _"is this in code that touches patient traffic?"_ Almost none of it is first-party Switchboard code — these are transitive libraries pulled in by the Meta/Google SDK stack and dev tooling.

| Package                | Severity       | Where it comes from                                     | Real exposure                                                                                                                                                  |
| ---------------------- | -------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono` (×4 advisories) | moderate       | Inngest / ad-optimizer / core                           | Middleware bypasses (JWT scheme, IP deny, cookie, mount path). You use **Fastify**, not Hono, for your own auth — Hono rides in via Inngest. Low real exposure |
| `protobufjs` (×2)      | moderate       | ad-optimizer (Google/Meta SDK)                          | DoS via malformed descriptor — needs hostile input into the protobuf layer                                                                                     |
| `qs`                   | moderate       | ad-optimizer / core                                     | DoS in `qs.stringify` on a specific edge case                                                                                                                  |
| `ws`                   | moderate       | core / creative-pipeline / db                           | Uninitialized memory disclosure (WebSocket lib)                                                                                                                |
| `uuid`                 | moderate       | transitive                                              | Missing buffer bounds check in v3/v5/v6                                                                                                                        |
| `turbo` (×2)           | moderate + low | **dev build tool only**                                 | Login-callback CSRF + local code-exec on Yarn detection — not in the production request path                                                                   |
| `brace-expansion`      | moderate       | via **ESLint** (dev only)                               | Range-based DoS in a linter dependency                                                                                                                         |
| 1 critical             | critical       | not enumerated by the tool's output                     | See note below                                                                                                                                                 |
| `GHSA-5xrq-8626-4rwp`  | critical       | suppressed via `package.json → auditConfig.ignoreGhsas` | An engineer chose to ignore this one; the justification isn't recorded in code                                                                                 |

**Honest limitation:** `pnpm audit` reports 2 criticals in its summary but only surfaces the suppressed GHSA id; it does not print the second (active) critical's record in either table or JSON output. An engineer should run `pnpm audit` interactively to enumerate it and confirm it isn't on a production path. I did not want to guess which package it is.

## Recommendation

- Run `pnpm update` (and `pnpm audit --fix` where safe) — most of these have patched versions available (`ws ≥8.20.1`, `hono ≥4.12.21`, `qs ≥6.15.2`, `uuid ≥11.1.1`, `turbo ≥2.9.14`, `protobufjs ≥7.5.8`).
- Have an engineer **identify and justify the active critical**, and document _why_ `GHSA-5xrq-8626-4rwp` is suppressed (an undocumented ignore is a small audit smell, not a vulnerability).
- None of these is an obvious remote-code-execution hole in first-party code, so this is the **lowest-priority** item in the audit — but the critical should be named before launch.

## Bottom line

No alarming first-party vulnerability. The advisories are dominated by dev tooling (turbo, eslint's brace-expansion) and the Meta/Google/Inngest SDK transitive stack, mostly DoS-class or niche middleware bypasses for middleware you may not even use. A routine `pnpm update` clears most of it; the one unresolved item is naming the active critical.
