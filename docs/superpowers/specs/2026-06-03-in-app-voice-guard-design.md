# In-app voice guard and voice spec (V1): design

Date: 2026-06-03
Status: design (for implementation on a separate branch)
Source of truth: `docs/audits/2026-06-02-ui-ux-feel-audit/direction.md` §6 "The voice and copy layer", §5 "Failure and empty states", principles I ("tell the truth at the commit moment") and VII ("honest when it fails"), and Wave 1 item 5 ("write the voice spec + extend the no-banned-claims guard into the app").

> Implementation update (post-adversarial-review). The shipped guard parses each corpus file with the TypeScript compiler and scans only extracted copy nodes (string literals, template-literal text, JSX text), rather than the hand-rolled comment-stripper and word-adjacency regex described in sections 3a, 5, and 9 below. An adversarial Codex review found the stripper-plus-regex approach could miss a dynamic em-dash connector built from interpolations and could misparse JSX URLs and template-interpolation comments. The compiler-based extraction resolves both at the root (so the section 9 comment-stripper risks no longer apply), and `agent-panel/open-decisions.tsx` was added to the corpus and de-em-dashed. The corpus, rules, and voice decisions below are otherwise as shipped.

## 1. Goal

So much of the product's trust thesis rides on words. Today that honest voice lives implicitly in a few strong surfaces (`states.tsx`, `risk-chips.ts`, `activity-voice.ts`, `work-log.tsx`) and is re-litigated every PR. V1 does two things:

1. Codify the honest in-app voice once, in a one-page in-repo spec.
2. Back the parts of it that are mechanically checkable with a CI guard, extending the proven marketing `no-banned-claims` pattern into the app.

This is the last unblocked Wave 1 foundation slice. It is explicitly NOT a redesign and NOT the type/spacing/elevation/dark work (TY2, SP1, EL1, dark mode), which are out of scope.

## 2. What the audit found (the data this design rests on)

Two read-only audit subagents swept `apps/dashboard/src` (excluding the marketing landing, tests, comments, and code identifiers).

**Em-dashes.** Roughly 178 user-visible em-dash hits across about 60 files, in two distinct populations:

- **The lone `"—"` no-data glyph** (~70 hits): a single em-dash rendered for a null/empty value, concentrated in the Mercury table surfaces (`reports`, `contacts`, `activity`, `automations` `format.ts` helpers and their cells). This is a typographic empty-cell convention, not prose. It is NOT the "AI tell."
- **Prose em-dashes** (~108 hits): an em-dash used as sentence punctuation in functional copy ("Couldn't save, try again" style errors, status bodies, metadata titles "X — Switchboard", placeholders, field help). This IS the tell the user dislikes.
- **Deliberate editorial em-dashes** (4): the Home weeknote prose connective and empty-state (`this-week.tsx:130,59`), the Results pull-quote byline "— Riley" (`verdict-line.tsx:18`), and the handoff "— from {agent}" byline (`handoff-detail-sheet.tsx:357`).
- **CSS generated content** (1): the weeknote letter signoff dash, `this-week.module.css:124` `content: "—"`.

**Attribution verbs.** Zero true "generated" attribution violations exist in user-visible copy. The honest verb convention (handled / booked / attributed / assisted) is mature and centralized in the agent-panel and Results surfaces. There are four borderline in-progress uses of the `generate` stem in Mira copy (status, not attribution) and a few acceptable uses (report timestamps, legal copy, a Meta UI instruction).

**Prior art.** The repo already has the house pattern for copy guards:

- `components/landing/v6/__tests__/no-banned-claims.test.ts`: per-pattern `it()` blocks scanning a corpus line by line, throwing with `file:line` offenders.
- `__tests__/cockpit-copy-hygiene.test.ts`: walks `components/cockpit` + `lib/cockpit`, substring-scans for banned phrases.
- `components/cockpit/__tests__/mira-copy-hygiene.test.tsx`: scans a curated SOURCES file list for forbidden regexes.

The in-app voice guard extends this pattern. It does not invent a new one.

## 3. The three genuine design decisions

### 3a. What the guard scans (corpus + false-positive avoidance)

A naive line scan for `—` across the app would flag hundreds of comment and code instances (about 360 comment em-dashes alone). So the guard cannot scan raw lines for em-dashes. Two mechanisms solve this:

**Comment stripping.** Before scanning, each file's source is run through a small, well-tested state machine that removes `//` line comments and `/* */` block comments while preserving string literals, template literals, and JSX text (so an em-dash inside a comment is removed, but an em-dash in copy survives). After stripping, the only surviving em-dashes are in copy, because code itself does not contain em-dashes.

**Bounded, curated corpus.** The guard scans an explicit SOURCES list of agent-voice copy surfaces, mirroring `mira-copy-hygiene`'s curated-list approach (not a directory walk). The V1 seed corpus is the copy that speaks as Alex / Riley / Mira or carries the shared honest-voice primitives:

- `lib/cockpit/mira/mira-config.ts`
- `lib/cockpit/mira/desk-copy.ts`
- `lib/cockpit/riley/riley-config.ts`
- `lib/decisions/risk-chips.ts`
- `components/query-states/states.tsx`
- `components/results/states.tsx`
- `components/agent-panel/lib/activity-voice.ts`
- `components/agent-panel/work-log.tsx`
- `components/cockpit/mira/mira-creative-feed.tsx`
- `components/cockpit/mira/mira-brief-box.tsx`
- `components/cockpit/mira/mira-clip-actions.tsx`
- `app/(auth)/mira/creatives/[id]/creative-detail-page.tsx`

The corpus is a named, exported constant with a comment explaining that it is the V1 seed and is meant to grow as more surfaces are de-em-dashed. It deliberately excludes:

- the Wave-0-active inbox and Home files (verified zero overlap, see 3c),
- the Mercury `"—"` table-placeholder surfaces (the lone-glyph convention, a separate "omit, don't placeholder" concern owned by Wave-0 #821 on the approval sheet),
- the marketing landing (it has its own `no-banned-claims` guard),
- the legal `(public)` pages and dev-only surfaces,
- all test files (the guard excludes itself by basename, like `cockpit-copy-hygiene`).

This honors the user's explicit instruction: "scope the guard to durable rules that pass today, and grow it."

### 3b. The banned rules and the em-dash decision

**Rule R1: no prose em-dash (the AI tell).** After comment stripping, the guard flags an em-dash (`—`, U+2014) that is adjacent to a word character (`[A-Za-z0-9]`), optionally across a single space, in either direction. This is the precise signature of an em-dash used as inline prose punctuation. It deliberately does NOT flag a lone `"—"` glyph (no adjacent word character), so the legitimate empty-cell convention is preserved even as the corpus grows. The literal `--` double-hyphen and the en-dash are documented in the voice spec but not CI-banned in V1 (the `—` character is the precise target; banning `--` risks false positives on CSS custom-property strings such as `var(--agent-mira)`).

**Rule R2: no "generated" attribution.** Within the corpus, the guard bans the verb stem `generat(e|es|ed|ing)` in copy (after comment stripping, so comments may still describe "generation"). The audit confirms zero attribution uses today; the four borderline Mira status uses are converted to the established draft/render voice as part of this PR, so the corpus is clean and the rule both passes today and prevents regression. Outside the corpus the word stays legal (report timestamps, legal copy, the Meta "Generate Token" instruction), so this is corpus-scoped, not app-wide, in V1.

**The em-dash verdict (the user-flagged tension), resolved:**

- **All functional / UI copy in the corpus: convert.** Replace the prose em-dash with a comma, colon, period, or restructure.
- **The Mira subtitle** `"Creative drafts — for your review"` (user-named): convert to `"Creative drafts, ready for your review"`.
- **The Home weeknote letter signoff** `this-week.module.css:124` `content: "—"` (user-named): drop the dash. This directly applies the user's standing rule "for letter sign-offs, drop the dash (just the name)." The signoff keeps its colored monogram and italic name, so none of the praised craft is lost. (This file is fixed but is not added to the guard corpus; CSS `content` scanning is a documented growth path, not a V1 rule.)
- **The pull-quote attribution bylines** "— Riley" (Results verdict) and "— from {agent}" (handoff) and the **weeknote prose voice**: preserve, as a narrow, documented editorial exemption. Rationale: a quote-attribution dash is a distinct typographic citation convention (not a letter signoff), and direction.md §3 explicitly designates the weeknote and the "— Riley" pull-quote as load-bearing craft to keep and never flatten. Converting them is a byline-treatment visual-design change that belongs with the aesthetic re-skin work, not the voice-guard slice. These surfaces are not in the guard corpus and are not changed in V1. The voice spec records this exemption and the tension with the user's general preference, so it is a deliberate, revisitable decision rather than an accident.

This is a narrow exemption (three specific editorial conventions), not the wide exemption the user warned against: every functional em-dash plus the two surfaces the user named by hand are fixed.

### 3c. Wave-0 coordination

The open Wave-0 stack (#814 to #827) is unmerged on `main`. The "Money at risk: —" placeholder grid is still live on `main` (Wave-0 #821 deletes it). A guard that banned em-dash placeholders would red on current `main`.

Mitigations, all verified:

- The guard is a brand-new test file (additive). It introduces no merge conflict with any Wave-0 PR.
- The corpus excludes every Wave-0-touched file. Verified by `gh pr diff --name-only` for #816/#818/#821/#822/#823/#824/#827: the union is `inbox-screen.tsx`, `approval-detail-sheet.tsx`, `inbox-decision-item.tsx`, `needs-you-card.tsx`, `use-recommendation-action.ts`, `use-queue-clear-metric.ts`, `use-toast.ts`, `undo-toast.tsx`, `compose-verdict.ts`, `globals.css`, `test-center.tsx`. None are in the corpus or the copy-fix set.
- R1 (word-adjacent em-dash) does not flag the lone `"—"` placeholder, so even if a placeholder surface were ever added to the corpus, it would not red.

Result: the guard passes on current `main` with no allowlist needed, and lands cleanly alongside the Wave-0 stack in any merge order.

## 4. The voice spec document (`docs/voice/in-app-voice.md`)

A one-page in-repo doc codifying the honest voice once, drawn from the real honest-voice code (not invented). It states each rule, gives a good and bad example from the actual codebase, and marks each as **[CI-enforced]** (in the corpus) or **[review-enforced]** (documented, not yet mechanically checked):

1. **Numbers.** Spell counts through ten in prose ("Two things need you"); always tabular figures in metric display. [review-enforced]
2. **Attribution verbs.** handled / attributed / assisted / booked / drafted. Never "generated." Conservative and operator-verifiable. [CI-enforced in corpus]
3. **Absence phrasing.** Omit, never placeholder. "No direct cost, comms-only" over "Money at risk: —". [review-enforced; the lone-glyph placeholder on trust surfaces is Wave-0 #821's job]
4. **Agent as actor, first person, never blaming.** "I'll pause and ask", "Already handled by your teammate", "started but didn't finish". [review-enforced]
5. **No em-dash AI tell in functional copy.** Use commas, colons, periods, or restructure. For letter sign-offs, drop the dash. Numeric ranges use a hyphen or "to". The weeknote letter voice and quote-attribution bylines are the one documented editorial exemption. [CI-enforced in corpus, prose em-dash only]

The guard's error messages point at this doc (mirroring how `cockpit-copy-hygiene` points at its spec), so a future contributor who trips it knows the rule and where to read it.

## 5. The guard mechanism

A single self-contained vitest file at `apps/dashboard/src/__tests__/in-app-voice.test.ts`, mirroring `no-banned-claims.test.ts` and `cockpit-copy-hygiene.test.ts`:

- A local `stripComments(src)` helper (state machine over chars: NORMAL, LINE_COMMENT, BLOCK_COMMENT, single/double/template string, with escape handling), with its own `describe` block of direct unit tests (empty input, line comment, block comment, comment-like text inside a string, an em-dash in a comment vs in a string, JSX text).
- A `containsProseEmDash(text)` helper using the word-adjacent regex, with its own unit tests proving it flags prose dashes and skips the lone `"—"` glyph and the concatenated `" — "` connective.
- The corpus SOURCES constant (the curated list above) and a smoke test asserting it is non-empty and every path exists.
- Per-rule `it()` blocks scanning the corpus: R1 prose em-dash, R2 `generat*` stem. Offenders reported as `file:line → trimmed line` with the reason and a "if this is now intended, update the voice spec and this test" note.

Keeping the helpers and their unit tests in the one guard file keeps the new-file count low (one new test file) while still directly testing the tricky comment-stripper, satisfying the co-located-test rule.

## 6. Copy fixes (the violations the guard will surface)

In-app copy only. Indicative conversions (final wording settled during implementation against the exact strings):

- `mira-config.ts`: subtitle "Creative drafts — for your review" -> "Creative drafts, ready for your review"; empty body "...Draft only — nothing is published..." -> "...Draft only. Nothing is published...".
- `desk-copy.ts`: `STAGE_COPY.production` "Generating draft" -> "Drafting"; `PROBLEM_COPY.unsafe` "Couldn't generate safely" -> "Failed a safety check"; brief placeholder/examples "Summer Botox special — $11/unit through July" -> "Summer Botox special: $11/unit through July"; `intentSummary` "Got it — ..." -> "Got it. ..." and "...generating the video is a separate step..." -> "...rendering the video is a separate step..."; off-scope redirect em-dash -> period.
- `creative-detail-page.tsx`: status/error bodies ("Couldn't load this draft — try again.", "Draft only — not published...", "No draft clip yet — still generating.", "Draft completed — ready for your review.", "...It stays a draft —", "Queued for your approval — ...", "Couldn't update the draft — try again.") -> de-em-dashed; "still generating" / "next generation step" -> draft/render voice.
- `mira-creative-feed.tsx`: "Couldn't load your drafts — pull to refresh." and "...as they generate." -> de-em-dashed and "as Mira drafts them".
- `mira-brief-box.tsx`, `mira-clip-actions.tsx`: error/status em-dashes -> de-em-dashed; any `generate` status -> draft/render voice.
- `results/states.tsx`: "Riley and Alex are already running — check back..." -> "...running. Check back...".
- `activity-voice.ts`: "I escalated {who} to you — {head}" -> de-em-dashed.
- `riley-config.ts`: input placeholder and quick-action chip em-dashes -> de-em-dashed.
- `this-week.module.css`: drop the signoff `content: "—"`.

Existing tests that assert any changed string (for example `desk-copy.test.ts`, the Mira hygiene/desk tests) are updated in the same PR.

## 7. Scope boundaries

- V1 only: the voice spec doc, the in-app guard, and fixing the violations it surfaces.
- Not in scope: EL1 (shadow ladder), SP1 (4pt spacing), TY2 (type/font), dark mode, the 178-site app-wide em-dash sweep, the Mercury lone-glyph placeholders, the marketing landing, and the pull-quote byline visual treatment.
- Growth path (documented, not built): widen the corpus surface by surface; add CSS `content` scanning; promote rules 1/3/4 from review-enforced to CI-enforced as they become mechanically robust.

## 8. Verification

- The four required checks green: typecheck, lint, test, security.
- Full dashboard vitest suite green (the guard plus updated copy tests).
- Live screenshots of the changed visible copy (Mira desk subtitle, a creative-detail status, the Home weeknote signoff) since visible copy changes.
- A reviewer subagent and `/codex:adversarial-review`, focused on guard correctness, false-positive risk, and the voice decisions; Critical and Important findings addressed before handoff.

## 9. Risks and mitigations

- **Comment-stripper edge cases** (regex literals, nested templates): low risk in the curated corpus (no em-dash-bearing regex literals in these files); mitigated by direct unit tests and the fact that a miss fails open (an un-stripped construct without an em-dash is a no-op).
- **Word-adjacent regex misses an em-dash adjacent only to interpolation or punctuation** (`}—`): accepted for V1; the known instances are fixed by hand; the guard is a backstop, not an exhaustive proof.
- **Corpus does not auto-cover new files**: accepted V1 trade-off, called out in the corpus comment as a growth task.
- **Wave-0 merge order**: no dependency; verified additive and non-overlapping.
