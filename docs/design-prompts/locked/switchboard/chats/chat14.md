# Pipeline Approval Activity

_Started 2026-05-13 02:59 UTC_

---

## User

use the pipeline, approval, activity design language to do up

## Assistant

_[tool: list_files]_

_[tool: local_ls]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: copy_files]_

_[tool: update_todos]_

I have enough context. The user wants /reports redesigned using the editorial paper-and-ink design language from activity-v2/approvals-v2/pipeline. I'll override the spec's Instrument Sans with Cormorant Garamond to match — that's the established display face across those pages.

Let me set up the folder and files.

_[tool: write_file]_

_[tool: write_file]_

_[tool: write_file]_

Now the app shell.

_[tool: write_file]_

_[tool: write_file]_

_[tool: grep]_

Good. Let me verify the page loads.

_[tool: show_html]_

_[tool: done]_

_[tool: fork_verifier_agent]_

Built **reports-v2** as an editorial second pass that uses the full ReportDataV1 schema and inherits the paper-and-ink language from `/activity` + `/approvals`:

**Layout (top → bottom):**

1. Topbar with org · page breadcrumb, sample/live pip
2. Header — eyebrow, "Operator's _Statement._" (Cormorant Garamond display, overriding spec's Instrument Sans to match the established design language), date folio + window selector + Recompute button
3. Pull quote — `{pre}<value>{mid}<cost>{post}` with amber-underlined emphases
4. Attribution — hero S$ number (display serif, tabular), amber delta badge, Riley/Alex split cards with share bars
5. Funnel — five hairlined rows, custom SVG-free bars (5 stages, ink → amber gradient), editorial byline beneath
6. Campaigns — sticky first column, sortable headers (default rev desc), every backend field (CTR, CPC, CPL, click→lead, ROAS), totals footer, ROAS depth via amber underline opacity (never RGB), mobile card fallback
7. Cost vs Value — three cells, amber-emphasized saving in display serif as the punchline
8. Managed comparison — two columns (Ads / Conversations), rendered only when present
9. Colophon — period, mode pip, generated timestamp

**Fixtures:** THIS WEEK (quiet, flat delta, `managedComparison: null`), THIS MONTH (S$14,720 showcase with managed comparison), THIS QUARTER (negative delta + Mar-Creative-Test with zero clicks to verify the muted-not-red treatment).

**Tweaks:** window switch, live-mode toggle, no-connection banner, force-null managedComparison.

SGD-only via `fmtSGD()` helper; no `$`, no green-good/red-bad, no chart libraries.
