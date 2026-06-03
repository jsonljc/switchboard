# In-app voice

How Switchboard speaks inside the app. One page.

The honest voice is the product's emotional moat: it tells the truth at the commit moment and stays honest when things fail. This doc codifies it once so it stops being re-litigated every PR. It is drawn from the surfaces that already get it right (`components/query-states/states.tsx`, `lib/decisions/risk-chips.ts`, `components/agent-panel/lib/activity-voice.ts`, `components/agent-panel/work-log.tsx`).

Each rule is tagged **[CI]** (mechanically enforced today by `apps/dashboard/src/__tests__/in-app-voice.test.ts` over a bounded agent-voice corpus) or **[review]** (enforced by code review until a robust, low-false-positive check exists).

## 1. Numbers [review]

Spell counts through ten in prose; use tabular figures in metric display.

- Good: "Two things need you." Plus a tabular hero numeral for the metric itself.
- Avoid: "2 things need you" in a sentence.

## 2. Attribution verbs [CI in corpus]

Agents handle, attribute, assist, book, and draft. They never "generate." This is conservative and verifiable against the operator's own calendar.

- Good: "Alex handled 14 leads; 9 booked." / "I booked {who}'s consult" (`activity-voice.ts`). The cockpit says "drafting" and "render step."
- Avoid: "Alex generated 14 leads." "Generating draft."
- Note: "generation" as a noun for a user-confirmed paid step is acceptable. The banned thing is the attribution verb.

## 3. Absence phrasing [review]

Omit what you do not know; never placeholder it, especially where money or a customer is at stake.

- Good: "No direct cost, comms-only." Risk chips simply omit the chip that does not apply (`risk-chips.ts`).
- Avoid: a "Money at risk" label followed by a bare dash on a spend decision. (The lone no-data glyph in a dense data table is a separate, acceptable typographic convention; this rule is about trust-critical prose.)

## 4. Agent as actor, first person, never blaming [review]

The agent speaks as itself, owns its actions, and never blames the operator or a teammate.

- Good: "I'll pause and ask." "Already handled by your teammate." "Saved, but we couldn't deliver it right now" vs "nothing was saved" (`states.tsx`, `handoff-detail-sheet.tsx`).
- Avoid: "You didn't set this up." The passive "an error occurred."

## 5. No em-dash AI tell in functional copy [CI in corpus, prose em-dash only]

The em-dash used as inline prose punctuation reads as generic machine writing. In functional and UI copy, use a comma, a colon, a period, or restructure the sentence.

- Good: "Couldn't save. Try again." "Creative drafts, ready for your review."
- Avoid: `Couldn't save — try again.`
- Letter sign-offs: drop the dash; sign with the name (and its monogram), not the name preceded by a dash.
- Ranges: use a hyphen or the word "to" ("last 30 days", "1 to 16 digits"), not an em or en dash.

### The editorial exemption (narrow and deliberate)

Two editorial conventions are intentionally kept and are not in the guard corpus:

- The Home weeknote prose voice (an "employee email"), which `docs/audits/2026-06-02-ui-ux-feel-audit/direction.md` section 3 designates as load-bearing craft.
- The quote-attribution byline under the Results verdict and the handoff suggested-opening byline, a standard citation convention.

The letter sign-off dash itself is dropped per rule 5; the quote-attribution byline is preserved. This is a deliberate, revisitable line, not an accident. The user dislikes em-dashes generally, so the bias is toward replacing them; revisit the byline treatment with the aesthetic re-skin work.

## How this is enforced

`apps/dashboard/src/__tests__/in-app-voice.test.ts` scans a bounded, curated corpus of agent-voice copy surfaces (the files that speak as Alex, Riley, or Mira, plus the shared honest-voice primitives). It strips comments first, so an em-dash inside a comment never false-positives, then flags two things in the surviving copy:

1. a prose em-dash (an em-dash adjacent to a word character, which leaves the lone no-data glyph alone), and
2. the "generate" verb stem.

The corpus is a V1 seed. Grow it surface by surface as more copy is brought onto the honest voice. Rules 1, 3, and 4 stay review-enforced until a robust check exists; widening them, and adding a CSS generated-content scan, are documented growth paths.
