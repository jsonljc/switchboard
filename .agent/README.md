# Switchboard Agent Operating Layer

`.agent/` is an AI-assisted build layer for Switchboard.

- It is not product runtime code.
- It is not loaded by the Switchboard application.
- It does not define customer-facing Alex behavior.
- It does not replace the product `skills/` directory.

## Structure

```
.agent/
├── RESOLVER.md          — Task → context router
├── ACCESS_POLICY.md     — What actions are allowed
├── memory/              — Project build memory (semantic committed, working gitignored)
├── skills/              — Operational workflows for audits and compression
├── conventions/         — Shared rules for architecture, evidence, and token budget
└── evals/               — Resolver routing correctness checks
```

## Operating Loop

1. **Ingest:** After important sessions, use `context-compression` to save only durable decisions, lessons, failures, open questions, and next actions.
2. **Query:** Use `RESOLVER.md` to load only the relevant skill, convention, and memory for the task.
3. **Lint:** When repeated confusion appears, add or revise a skill, convention, resolver route, or eval. Do not add reminders.
