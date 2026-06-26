# Mira self-brief eval (EV-6)

Closes **INFRA-3 (Mira) + AGENT-8 + AGENT-9** from
[`docs/audits/2026-06-25-eval-coverage`](../../docs/audits/2026-06-25-eval-coverage/README.md).
Mira was the only core agent with **zero real-generation eval** — her propose/abstain judgment and
claim-cleanliness were unverified (only the parser had shape-only fixture tests). This harness drives
Mira's **real** compose generation and grades it through the **real** downstream parser.

## What it drives

The production compose path, faithfully: the real `skills/mira/SKILL.md` body rendered with golden
parameters (taste, measured performance, frontline demand, pipeline state, trigger) through a
zero-tool / zero-hook `SkillExecutorImpl` (the production compose executor, spec 3.4), then the **real**
`parseMiraComposeOutput` (`@switchboard/schemas`).

## Two legs

| Leg                                           | Runs                                             | Gating                                                   |
| --------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| **Deterministic grader** (`grade-compose.ts`) | every CI run, **no key** (the `__tests__` suite) | **BLOCKING**                                             |
| **Live generation + judge** (`run-eval.ts`)   | only with `ANTHROPIC_API_KEY`                    | informational; a live deterministic violation hard-fails |

The deterministic grader is the deliverable. For a driven compose result it checks:

- **shape** — the real `parseMiraComposeOutput` accepts it;
- **contract-bleed (AGENT-9)** — no `<intent>` / `<qualification_signals>` in the raw output, AND the
  executor's `intentClass` / `qualificationSignals` strip side-channels are unset (a set value means
  Mira emitted a cross-agent tag the executor stripped);
- **banned claims** — sharp **lexical** bans from the SKILL.md claim boundaries (the words the skill
  forbids outright: `removes`, `permanent`, `guaranteed`, … plus regulated/safety absolutes like
  `FDA-approved`, `risk-free`, `cure`) in the **brief** fields. The match is lexical by design: a
  collocation like "semi-permanent" still fires, which is contract-faithful (a disciplined brief
  avoids the word). **The deterministic claim teeth are lexical only** — soft superlatives and the
  skill's _phrasal_ bans (before/after-photo PROMISES, outcome TIMELINES) are left to the judge, which
  reads phrasing in context, so the blocking leg is not the full claim-safety surface;
- **graceful degradation** — a crashed drive is a violation, not an unhandled throw.

The live judge (`compose-judge.ts`, key-gated, fail-closed) scores propose/abstain appropriateness,
grounding, and claim cleanliness against a committed baseline (judge-score drift only; deterministic
violations always hard-fail).

## ⚠️ Surfaced defect — the empty-messages gap (F1)

Building this harness surfaced a **real latent defect**: production's compose submit carries **no
conversation**, so `skill-mode` forwards `messages: []` to the executor, which forwards `[]` to
`client.messages.create`. A **live** Anthropic call rejects an empty `messages` array (≥1 message
required), so the first time `MIRA_SELF_BRIEF_ENABLED` flips on, **every compose would 400** and Mira
would silently never propose. It is masked today only because the feature is dark and the compose has
never run live — which is exactly why AGENT-8's coverage was "none".

The harness drives the model with a minimal `COMPOSE_USER_TURN` — the "go" turn the production fix
must add — and a guard test stops a regression back to `[]`. The production fix (have the compose
submit carry a minimal user turn) is tracked as a follow-up, separate from this eval.

## Live idiom

Idiom (a): `run-eval.ts` is a tsx script that **soft-skips** when `ANTHROPIC_API_KEY` is absent on a
branch and **hard-fails (`exit 2`)** on a `main` push (so a silent skip on main is impossible once the
key is restored, INFRA-1). No `baseline.json` is committed yet — there is no key to bake an honest one;
the runner treats an absent baseline as informational (it never fabricates scores).

## Run

```bash
pnpm exec vitest run --config evals/vitest.config.ts mira-self-brief/__tests__   # deterministic, blocking, no key
ANTHROPIC_API_KEY=sk-... pnpm eval:mira-self-brief                               # live generation + judge
ANTHROPIC_API_KEY=sk-... pnpm eval:mira-self-brief --write-baseline              # bake the baseline (post-INFRA-1)
```
