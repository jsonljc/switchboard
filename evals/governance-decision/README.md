# Governance-Decision Eval Harness

Deterministic regression matrix for the live tool-governance gate
(`getToolGovernanceDecision` + `GOVERNANCE_POLICY` in
`packages/core/src/skill-runtime/governance.ts`).

Unlike the claim-classifier and alex-conversation harnesses, this one is
**model-free and DB-free**: every case is resolved through the real gate and
compared to an expected decision. It needs **no `ANTHROPIC_API_KEY` and no
Postgres**, so it runs in CI as a plain vitest test and is fully reproducible
locally.

## Run locally

```bash
pnpm eval:governance                  # CLI runner (prints a report)
pnpm exec vitest run --config evals/vitest.config.ts governance-decision   # the gate
```

## What it covers

- **The full policy grid:** every `EffectCategory` × `TrustLevel` combination
  (7 × 3 = 21 cases) pinned to the decision the live gate returns
  (`auto-approve` | `require-approval` | `deny`).
- **Override resolution:** an operation's `governanceOverride` wins for the trust
  levels it covers and falls back to the base policy otherwise.
- **Drift guard:** the test asserts the fixture grid covers exactly the keys
  present in the live `GOVERNANCE_POLICY`. If core adds a new effect category or
  trust level, this test fails (under-coverage) rather than passing silently.

## Add a case

One JSONL row in `fixtures/`:

```json
{
  "id": "grid-write-supervised",
  "effectCategory": "write",
  "trustLevel": "supervised",
  "expectedDecision": "require-approval",
  "notes": "supervised writes need a human"
}
```

| Field                | Required | Description                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `id`                 | yes      | Unique slug (kebab-case).                                                        |
| `effectCategory`     | yes      | One of read/propose/simulate/write/external_send/external_mutation/irreversible. |
| `trustLevel`         | yes      | supervised \| guided \| autonomous.                                              |
| `governanceOverride` | no       | Per-trust-level decision override the operation declares.                        |
| `expectedDecision`   | yes      | auto-approve \| require-approval \| deny.                                        |
| `notes`              | no       | Free-text justification.                                                         |

## Out of scope (documented in the design spec)

- **Trust-score → tier mapping** (`trustLevelFromScore`, thresholds ≥55 / ≥30):
  the function is currently private to `prisma-deployment-resolver.ts`; pinning
  its boundaries needs a small export and is a noted follow-up.
- **PII minimization / cross-tenant isolation:** no pure, importable decision
  function exists to oracle against without a live runtime / DB.
