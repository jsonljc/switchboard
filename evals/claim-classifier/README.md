# Claim Classifier Eval Harness

Regression evaluation for the medical-claim classifier (`packages/core/src/governance/classifier/`).

## Run locally

```bash
ANTHROPIC_API_KEY=... pnpm eval:classifier
```

The harness loads every `*.jsonl` file from `fixtures/`, runs each row through the live Anthropic classifier (Haiku 4.5), and prints a per-claim-type accuracy table. If `baseline.json` exists, it also runs a no-regression check (each claim type must stay within `toleranceBps` of baseline).

## Add a fixture

A fixture is one JSONL row:

```json
{
  "id": "sg-efficacy-001",
  "text": "PicoSure removes 100% of tattoo ink in one session.",
  "language": "en",
  "jurisdiction": "SG",
  "expectedClaimType": "efficacy",
  "notes": "Hard 100% guarantee."
}
```

Fields:

| Field                  | Required | Description                                                                                       |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `id`                   | yes      | Unique slug (kebab-case). Used in reports.                                                        |
| `text`                 | yes      | One sentence the classifier sees verbatim.                                                        |
| `language`             | yes      | `en` \| `zh` \| `ms`. Used to route to the right golden set.                                      |
| `jurisdiction`         | yes      | `SG` \| `MY`. Some claim types are jurisdiction-specific.                                         |
| `expectedClaimType`    | yes      | The single correct label from the 9-category enum.                                                |
| `acceptableClaimTypes` | no       | Array of additional labels considered correct (use sparingly; for genuinely ambiguous sentences). |
| `notes`                | no       | Free-text justification for human reviewers.                                                      |

## Regenerate baseline

After a deliberate, reviewed change to the classifier prompt:

```bash
ANTHROPIC_API_KEY=... pnpm eval:classifier --write-baseline
```

This rewrites `baseline.json`. Commit the file in the same PR as the prompt change.
