# Skill: Context Compression

## Purpose

Compress long sessions into durable Switchboard memory.

## Use when

- A session has produced important decisions or lessons
- Context window is growing large
- Switching to a new task
- User asks to summarize or compact

## Inputs

- Current session context
- `.agent/memory/semantic/LESSONS.md`
- `.agent/memory/semantic/DECISIONS.md`

## Process

1. Review session for durable content.
2. Extract decisions (what was decided and why).
3. Extract lessons (what was learned that applies to future work).
4. Extract failures (what went wrong and what structural fix prevents recurrence).
5. Identify invariant updates if any.
6. Identify open questions.
7. Identify next actions.
8. Identify skill/tool/eval candidates (repeated patterns that should become structural).
9. Append to the relevant `.agent/memory/semantic/` file.

## Output

- Decisions (append to DECISIONS.md)
- Lessons (append to LESSONS.md)
- Failures (append to FAILURES.jsonl)
- Invariants updated (if any)
- Open questions
- Next actions
- Skill/tool/eval candidates

## Do not store

- Full transcripts.
- Repeated explanation.
- Generic praise.
- Unverified assumptions.
- Personal preferences (those belong in harness memory).

## Quality bar

- Every extracted item is specific and actionable.
- Decisions include rationale.
- Lessons are stated as reusable rules, not episode summaries.

## Failure modes

- Storing raw session transcript instead of distilled content.
- Including generic observations ("we had a productive session").
- Missing a decision that was made implicitly.
- Storing assumptions as facts.

## Done when

- All durable content from the session is captured in the appropriate memory file.
- No transcript content remains — only distilled decisions, lessons, and failures.
