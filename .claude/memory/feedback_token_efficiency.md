---
name: Token efficiency practices
description: Use /clear between major task switches, delegate verbose ops to subagents, use haiku for simple lookups
type: feedback
originSessionId: 08971506-6cda-42a7-bd56-dbc78be67e26
---

Use /clear between major task switches (e.g., after finishing a PR, before starting a new topic). Context accumulates tool results and conversation history — a 20-turn session reprocesses everything on each message.

**Why:** Long sessions with mixed topics waste tokens reprocessing stale context. The 1M window makes this worse, not better.

**How to apply:**

- Suggest /clear when the user pivots to a new topic after completing a major task
- Spawn subagents with `model: "haiku"` for simple searches/lookups
- Use /compact when context gets large mid-task
- Keep subagent prompts self-contained so verbose output stays isolated
