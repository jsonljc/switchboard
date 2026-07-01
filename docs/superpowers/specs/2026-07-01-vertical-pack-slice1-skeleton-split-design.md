# Vertical-Pack Slice 1 — SKILL.md Skeleton Split + Golden Prompt-Diff Harness — Design

**Date:** 2026-07-01
**Workstream:** pack-extraction (see `project_vertical_pack_extraction`, `project_b2b2c_pivot`)
**Status:** Design — approved interactively 2026-07-01 (three design forks resolved by the operator).

## 1. Problem & leverage

The B2B2C pivot makes the governed platform substrate the product ("Shopify for service-business agents"): onboard any vertical, safe by construction. The first engineering prerequisite is that a new vertical (dental, fitness) must **not inherit medspa's clinical content**. Today `skills/alex/SKILL.md` bakes medspa specifics — most dangerously a `## Medical red flags` block (lines 291–341: changing moles, pregnancy+treatment, blood thinners+injectables, HIFU/RF/laser after surgery) — directly into the agent's system prompt. A dental agent booting off this skill would tell leads to escalate on HIFU red flags it will never encounter, and would be missing dental-specific ones.

Slice 1 is the reversible on-ramp for the whole extraction: split the skill into a **vertical-agnostic skeleton** plus one repo-bundled **pack block**, and stand up the **golden behavior-diff harness** that makes "medspa still renders byte-identical" an automatic, free CI gate on this and every later pack slice.

### The safety insight that shapes the mechanism

The `## Medical red flags` block is currently hardcoded in the skill _body_, so `interpolate()` renders it **unconditionally, byte-for-byte, in every environment**. The seductive shortcut — reuse the existing `{{CLAIM_BOUNDARIES}}` context-injection mechanism — is **wrong for a safety block**:

- Production resolves `context:` slots via `SkillMode.resolveContextVariables` (`packages/core/src/platform/modes/skill-mode.ts:158-180`) against **DB-backed KnowledgeEntry rows**, and it **fails open**: on any resolution miss it logs and returns `{}`, so the slot renders empty. The frontmatter marks these slots `required:false` on purpose so a live conversation never 500s on a missing row (`skills/alex/SKILL.md:66-70`).
- The eval harness stubs the same slots from files (`createStubContextStore(refsDir)`), so a file-backed test would show "byte-identical" while production silently dropped the red flags because a KnowledgeEntry row was never provisioned.

That is exactly the `feedback_safety_gate_needs_producer_population` failure mode. **Invariant for this slice: the safety block stays unconditionally present, sourced from a repo-bundled pack file, fail-closed at load.** Never routed through a fail-open DB slot.

## 2. Scope

**In scope:**

1. Extract the `## Medical red flags` block (291–341) out of `skills/alex/SKILL.md` into a repo-bundled medspa pack file.
2. A pack-overlay composition step in the skill loader that splices pack blocks into the skeleton at load time, fail-closed.
3. The golden prompt-diff harness: a model-free eval that byte-snapshots the fully-assembled medspa system prompt and gates zero-diff in CI.
4. Extract the prompt-assembly tail of `SkillExecutorImpl.execute` into a pure, exported `buildSystemPrompt` so the harness snapshots exactly what production sends.

**Out of scope (explicitly deferred, with rationale):**

- **Vertical _selection_ logic** — choosing medspa vs dental from onboarding input is Slice 3 (provisioning). Slice 1 hardcodes `pack: medspa`, reproducing today's behavior; it only introduces the _seam_.
- **Intent-tag taxonomy & disqualifier-reason extraction** — the WhatsApp intent tags (104–120) and disqualifier types (438–440) are vertical-generic enough today; extract them in a later slice when a consumer needs them to differ (YAGNI). The composer is built general so adding blocks later is a one-line marker + one file.
- **Jurisdiction / loader re-key** — banned-phrases and escalation-triggers re-keying is Slice 2.
- **L1 `regulatoryProfileId` refactor** — the open-profile / pack-registry work is a later, separately-costed series.
- **cartridge-sdk deletion** — orthogonal cleanup.
- **Governance-verdict & classifier snapshotting inside the new harness** — the SKILL.md split does not touch those code paths; rely on the existing model-free `evals/governance-decision` and the credit-gated `evals/claim-classifier`. Adding them here would duplicate coverage for zero Slice-1 risk.

## 3. Canonical decisions (the three forks, resolved)

1. **Injection = loader splice / pack files** (not builder-sourced param, not context injection). Pack blocks are repo-bundled markdown spliced into the skeleton body at load time. The loader already does filesystem reads (`loadReferences`), so it is the natural home; the builder reads only injected stores and should stay data-focused. Rejected: reuse of the `context:` mechanism (fail-open DB slot, see §1); builder-sourced param (couples the builder to pack-file layout).
2. **Split scope = safety block only.** Only the one block that is dangerous for another vertical to inherit moves this slice.
3. **Harness gate = the rendered system prompt.** One byte-exact snapshot per medspa fixture of the fully-assembled prompt (skeleton + spliced safety block + every injected slot + governance tail).

## 4. Part A — the pack-overlay mechanism

### 4.1 File layout

```
skills/alex/
  SKILL.md                       # skeleton: vertical-agnostic body + a pack marker + `pack: medspa` frontmatter
  packs/
    medspa/
      safety-escalation.md       # the verbatim 291-341 block (plain markdown, no frontmatter)
  references/                    # UNCHANGED — DB-synced context knowledge, a separate mechanism
    medspa/ ...
```

`packs/` is deliberately a **sibling of `references/`, not inside it**, so `loadReferences()` (which walks `skills/alex/references`) never picks up pack files, and the two mechanisms stay conceptually distinct: `references/` = context knowledge resolved (and in prod, DB-synced) into `{{…}}` slots; `packs/` = body composition spliced before interpolation.

### 4.2 The marker & the composer

- In the skeleton body, lines 291–341 are replaced by a single marker line:
  `<!-- @pack:safety-escalation -->`
- The skeleton frontmatter gains an optional field: `pack: medspa`.
- New pure function `composePackBody(body: string, packDir: string | undefined): string` in `packages/core/src/skill-runtime/pack-composer.ts`:
  - Scans `body` for `<!-- @pack:<slot> -->` markers (regex, slot ∈ `[a-z][a-z0-9-]*`).
  - **No markers** → returns `body` unchanged. (Guarantees every other skill — mira, sales-pipeline, website-profiler, ad-optimizer — is provably untouched, regardless of whether they declare a `pack`.)
  - **Marker present, `packDir` undefined (no `pack:` declared) or `packDir/<slot>.md` missing** → throws `SkillValidationError` naming the slot and expected path. Fail-closed on both the missing-pack and orphan-marker cases: a skill that references a safety slot it cannot supply fails loudly at load / A0 preflight, never renders an empty (or literal-comment) safety envelope into live traffic.
  - **Marker present, file present** → replaces the marker with the file's exact bytes.
- `loadSkill` (`skill-loader.ts:190-262`) wiring: after `splitFrontmatter` and frontmatter parse, **always** call `body = composePackBody(body, packDir)` **before** the `body.trim()` / validation / return, where `packDir = frontmatter.pack ? join(skillsDir, slug, "packs", frontmatter.pack) : undefined`. Calling it unconditionally is what makes the orphan-marker case fail-closed (a marker with no `pack:` still throws) rather than leaking the comment into the prompt. Interpolation and everything downstream are unchanged and operate on the composed body.
  - `SkillFrontmatterSchema` gains `pack: z.string().optional()`.
  - A reserved optional `packOverride` parameter on `loadSkill` is **defined but unused** in Slice 1 (Slice 3 supplies it from onboarding). Documented, not wired.

### 4.3 Byte-identical guarantee

The composed body must equal today's body byte-for-byte, so the assembled prompt is identical. This is guaranteed constructively and asserted by test:

- `packs/medspa/safety-escalation.md` contains exactly the substring that occupies 291–341 today.
- The marker replaces exactly that substring (no added/removed newlines around it), so `composePackBody(skeleton, medspaPackDir) === originalBody` (byte-exact).
- Enforced by a unit test that captures the pre-split body as a fixture and asserts equality, and end-to-end by the golden harness (§5).

## 5. Part B — the golden prompt-diff harness

### 5.1 `buildSystemPrompt` extraction

The prompt tail currently lives inline in `SkillExecutorImpl.execute` (`skill-executor.ts:305-307`):

```ts
const interpolated = interpolate(params.skill.body, params.parameters, params.skill.parameters);
const system = `${interpolated}\n\n${getGovernanceConstraints()}`;
```

Extract it to a pure, exported `buildSystemPrompt(skill: SkillDefinition, parameters: Record<string, unknown>): string` in a new co-located `packages/core/src/skill-runtime/system-prompt.ts`, and have `execute` import and call it (keeps `skill-executor.ts` from growing and gives the harness a clean import target). This gives the harness a single source of truth: it snapshots exactly the string `execute` sends the model, with no risk of the harness and production drifting. `getGovernanceConstraints()` returns a static constant (`governance-injector.ts:18`), so the tail is byte-stable.

### 5.2 Harness layout

```
evals/skill-prompt-golden/
  render.ts                 # loadSkill("alex") + resolveParameters(fixture) + buildSystemPrompt
  fixtures.ts               # ~3-4 medspa param bundles; CURRENT_DATETIME pinned
  snapshots/                # committed golden .txt (one per fixture) — the golden master
  __tests__/golden.test.ts  # renders each fixture, toMatchFileSnapshot against snapshots/
  package.json
```

- Reuses the same deterministic parameter-resolution path the alex-conversation harness uses (`evals/alex-conversation/run-conversation.ts:resolveParameters` — persona via `resolvePersona`, `alexBuilder` over stubbed stores, `ContextResolverImpl` over the file-stub context store). **Plan-phase verification:** confirm eval-package-to-eval-package imports resolve in the workspace; if they do, import `resolveParameters` directly; if not, mirror the ~40-line resolution inline in `render.ts` (it is small and stable). Fixtures vary the axes that flow into injected slots: **facts present/absent × SG/MY persona** (~3–4 bundles).
- **Determinism:** `CURRENT_DATETIME` is pinned in every fixture (no `Date.now()`); the file-stub context store makes context slots deterministic; temperature/model never enter (no LLM call). This is the point of choosing the rendered prompt over live model output.
- Wired into `evals/vitest.config.ts` so it runs in the **free, model-free CI path** (no `ANTHROPIC_API_KEY`), the same class as `evals/governance-decision`.

### 5.3 Gate & baseline flow

- Gate: `expect(rendered).toMatchFileSnapshot("snapshots/<fixture>.prompt.txt")`. `vitest -u` regenerates snapshots deliberately.
- Baseline is captured from **current `main`** (pre-split): the harness lands green against the monolith first, locking today's medspa render. The split must keep it green — a byte of drift reddens it. Zero-diff-for-medspa is the merge gate for this slice and every later pack slice.
- CI note: the harness sits under `evals/`; `skills/alex/**` and `packages/core/src/skill-runtime/**` already trigger the alex-conversation eval job — keep that green too.

## 6. Components & file plan

```
skills/alex/SKILL.md                                   (EDIT: 291-341 -> marker; frontmatter += pack: medspa)
skills/alex/packs/medspa/safety-escalation.md          (NEW: verbatim 291-341 block)
packages/core/src/skill-runtime/pack-composer.ts       (NEW: composePackBody, pure)
packages/core/src/skill-runtime/__tests__/pack-composer.test.ts   (NEW: no-marker no-op / splice / fail-closed)
packages/core/src/skill-runtime/skill-loader.ts        (EDIT: call composePackBody; frontmatter schema += pack)
packages/core/src/skill-runtime/skill-executor.ts      (EDIT: import + call buildSystemPrompt)
packages/core/src/skill-runtime/system-prompt.ts       (NEW: buildSystemPrompt, pure)
packages/core/src/skill-runtime/__tests__/system-prompt.test.ts   (NEW: assembly + execute-routes-through-it)
packages/core/src/skill-runtime/index.ts               (EDIT if needed: export buildSystemPrompt)
evals/skill-prompt-golden/*                            (NEW harness, mirrors evals/governance-decision layout)
evals/vitest.config.ts                                 (EDIT: include the new __tests__)
```

`>3 new files` is justified: this is an extraction-mechanism slice plus its regression harness; each new module is focused and co-located with tests per CLAUDE.md.

## 7. Data flow

**Load (changed):** `readFileSync(SKILL.md)` → `splitFrontmatter` → parse frontmatter (now with `pack`) → **`composePackBody(body, packs/medspa)`** → validate/trim → `SkillDefinition{ body: composed }`.

**Render (unchanged logic, now via a named fn):** `buildSystemPrompt(skill, parameters)` = `interpolate(composed body, parameters, declarations)` + `"\n\n"` + `getGovernanceConstraints()` → the system string `execute` sends the model.

**Harness (model-free):** for each fixture → `loadSkill("alex")` → `resolveParameters(fixture)` → `buildSystemPrompt` → `toMatchFileSnapshot`. No model, no DB, no network.

## 8. Error handling & determinism

- `composePackBody` is total on well-formed input: no markers → identity; every marker resolved → spliced; any unresolved marker → `SkillValidationError` (fail-closed) at load, surfaced by provisioning / A0 preflight, never at render.
- Skills without a `pack` frontmatter field are unaffected (composer never invoked with markers).
- Harness determinism: pinned `CURRENT_DATETIME`, file-stub context, no `Date.now()`/random in fixtures or tests; committed snapshots are the oracle.

## 9. Testing strategy (TDD, RED-first)

Enforced RED proof per step (per `.claude/build-loop.md`):

1. **`buildSystemPrompt`** — RED: a test importing `buildSystemPrompt` fails (unexported/undefined) and an assertion that `execute` produces the same system string via the extracted fn; GREEN: extract + export + route `execute` through it.
2. **Golden harness on the monolith** — add harness; capture snapshots from _current_ SKILL.md; green baseline = today's medspa render locked. (RED here is the missing snapshot file on first run; committing the reviewed snapshot is the deliberate lock.)
3. **`composePackBody`** — RED: `composePackBody(skeletonWithMarker, medspaPackDir)` ≠ captured original body (fn absent/stub); plus fail-closed test (marker + missing file → throws) and no-op test (no marker → identity). GREEN: implement.
4. **The split** — move the block to the pack file, insert the marker, add `pack: medspa`; wire `loadSkill`. Done-condition: the golden harness stays **green** (byte-identical) and the alex-conversation eval structural tests stay green.

## 10. Risks & mitigations

| Risk                                          | Mitigation                                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whitespace/byte drift in the split            | `composePackBody === originalBody` unit test + the golden prompt snapshot both bite on a single byte.                                                                                               |
| A safety block silently renders empty in prod | Fail-closed composer (throws at load), not a fail-open DB slot; that is the whole point of choosing loader-splice over context injection.                                                           |
| Other skills regress                          | Composer is a no-op without markers; a test asserts identity for a marker-less body; only `skills/alex` gains a `pack`.                                                                             |
| Harness non-determinism (flaky snapshots)     | Pinned `CURRENT_DATETIME`, file-stub context, no model/DB/network, deterministic `loadReferences` ordering already in place.                                                                        |
| Live revenue path touched                     | `skills/alex/**` + `skill-runtime/**` trigger the alex-conversation eval gate; keep green. No merge-stop glob (no governance/PlatformIngress/auth/billing/migration) → normal SURFACE-before-merge. |

## 11. Rollback

Fully reversible with no data/schema footprint: revert the SKILL.md marker back to the inline block, delete `skills/alex/packs/`, delete `evals/skill-prompt-golden/`, and revert the `composePackBody`/`buildSystemPrompt` edits. Because the composer is a no-op without markers and `buildSystemPrompt` is behavior-preserving, a partial revert (e.g. keep the harness, undo the split) is also safe.

## 12. Decisions log

1. **Loader-splice over context-injection** — a safety block must be unconditionally present and fail-closed; the `context:` mechanism is fail-open and DB-backed (§1).
2. **`packs/` sibling to `references/`** — distinct mechanism (body composition vs context resolution); avoids `loadReferences` double-load.
3. **Safety block only this slice** — the sole block dangerous to inherit; mechanism built general for cheap later extraction (YAGNI).
4. **Rendered prompt as the gate** — the one artifact the split changes; deterministic and free in CI; governance/classifier axes stay with their existing evals.
5. **`buildSystemPrompt` extraction** — single source of truth so harness and production cannot drift.
6. **`pack:` in frontmatter, selection deferred** — introduces the seam, hardcodes medspa (today's behavior); Slice 3 supplies the override.
