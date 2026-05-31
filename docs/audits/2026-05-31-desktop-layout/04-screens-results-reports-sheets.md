# Desktop Layout Audit — Results, Reports, Sheets/Drawers

Scope: the Results screen/tab, `/reports`, and the agent-panel drill-in Sheet plus
sibling Sheet/Dialog/Drawer primitives. Desktop = ≥1024px. Read-only audit.

Shell context (owned by another auditor, stated here for grounding): the authed
`<main>` (`apps/dashboard/src/components/layout/editorial-auth-shell.tsx:46`) has
**no bare `main {}` width rule** in `globals.css` — it is full-bleed; each page owns
its own width. The shell offers generous width utilities the page CAN opt into —
`.page-width` (74rem), `.dashboard-frame` (76rem, 88rem ≥1440px) at
`apps/dashboard/src/app/globals.css:324,334,350`. **Results does not use any of
them.** So every width cap below is self-imposed by the screen, not the shell.

Headline: **Reports (`/reports`) is already a real desktop layout** (74rem, multi-
column grids — the gold standard). **Results is a 640px stretched-mobile column.**
**Every drawer/sheet is mobile-width on desktop** (agent panel = full-width bottom
sheet; inbox/contacts drawers ≤ ~384–448px right rail).

---

## 1. RESULTS

Entry: `apps/dashboard/src/app/(auth)/results/page.tsx` → `ResultsPage`
(`apps/dashboard/src/components/results/results-page.tsx`). Styles:
`apps/dashboard/src/components/results/results.module.css`.

### Current Layout (FACTS)

- **The whole screen is capped at 640px and centered.** The single layout wrapper
  is `.column`:
  - `results.module.css:1250-1256` — base `width:100%; padding:4px 18px 28px; display:flex; flex-direction:column; gap:22px`.
  - `results.module.css:1258-1265` — `@media (min-width:768px){ .column { max-width:640px; margin:0 auto; padding:28px 32px 40px; gap:28px } }`.
  - There is **no breakpoint above 768px** — at 1024/1440/1920px the column stays
    640px and centers, so a 1440px viewport wastes ~800px of horizontal space.
    This is the literal "stretched mobile column."
- All children stack vertically inside that 640px column (`results-page.tsx:116-130`):
  `ResultsHeader → VerdictLine → HeroOutcomes → WhatsWorking → AgentContribution →
WorthIt → DetailsDisclosure(Funnel, Campaigns, ManagedComparison) → Colophon`.
- **Hero / KPIs are a vertical flex stack, not a KPI grid.**
  - `.heroOutcomes` `display:flex; flex-direction:column; gap:1.5rem` (`:41-45`).
  - `.heroCoRow` (consults + ad spend) is `flex; gap:2rem; flex-wrap:wrap` (`:83-88`) —
    inline only because two small stats fit; not a real responsive grid.
  - Revenue/consults numbers bump font-size at 768px only (`:65-69, 108-112`) — no
    layout change, just bigger type in the same narrow column.
- **Funnel is a single column of full-width rows** (no side-by-side breakdown).
  - `.funnelRow` `display:grid; grid-template-columns:9rem 1fr auto auto auto` (`:403-408`).
    The `1fr` bar eats the full 640px width; the section is one stacked list
    (`.funnelRows` `flex-direction:column` `:393-400`).
- **Agent-contribution cards** go row at ≥560px (`.agentCards` `:947-958`, `flex-
direction:row`), `.agentCard{flex:1}` (`:961`). Already multi-column, but bounded
  by the 640px column → three thin cards.
- **WorthIt (cost vs value)** three cells: column, then row at ≥560px (`.worthItCells`
  `:254-266`).
- **ManagedComparison** two-column grid `1fr 1fr` collapsing to 1fr only `≤559px`
  (`.mcGrid` `:832-842`) — so it IS two-up on desktop, but inside 640px.
- **Campaigns table** is genuinely layout-aware (the one screen element that already
  branches): `ResultsPage` computes `layout` from `matchMedia("(min-width:1024px)")`
  (`results-page.tsx:63-73`) and passes it to `<CampaignsSection layout={layout}/>`
  (`results-page.tsx:100`). At `layout==="desktop"` it renders a full sortable
  `<table>` with sticky first column (`campaigns-section.tsx:126-275`;
  `.campaignTableWrap{overflow-x:auto}` `:489-492`, `.campaignTable{width:100%}`
  `:494-499`). At mobile it renders sort-chips + cards (`campaigns-section.tsx:286-347`).
  **But the table also lives inside the 640px column**, so the 11-column table is
  forced into horizontal scroll on desktop despite acres of free page width
  (`.campaignThRoas{min-width:120px}` `:520-522`; sticky cols `:512-518, 554-563`).

### Desktop Opportunities (RESULTS)

1. **Lift the 640px cap on desktop.** Add a ≥1024px rule to `.column`
   (`results.module.css:1258`) raising `max-width` (e.g. ~960–1100px, or adopt the
   shell's `.page-width`/`--content-width`). Single highest-leverage change — every
   child immediately gets room. (file: `results.module.css:1250-1265`).
2. **Two-pane editorial grid on desktop.** Above ~1024px, split the stacked body into
   a 2-column grid: narrative rail (VerdictLine, WhatsWorking, WorthIt narrative) on
   the left, data rail (HeroOutcomes KPIs, Funnel, AgentContribution, ManagedComparison)
   on the right — instead of one long scroll. Driven from `results-page.tsx:86-112`
   render order + a new grid class in `results.module.css`.
3. **Real KPI grid for the hero.** Replace `.heroOutcomes` flex-column with a
   `grid-template-columns: repeat(auto-fit, minmax(...))` at desktop so revenue /
   consults / ad-spend / (and AgentContribution cards) sit as a true multi-column KPI
   band (`results.module.css:41-45, 83-88`).
4. **Side-by-side funnel + campaigns/breakdown.** With the wider column, place the
   `.funnelSection` next to `CampaignsSection` (or the ManagedComparison) in a 2-col
   grid rather than vertically inside `DetailsDisclosure` (`results-page.tsx:95-103`).
5. **Let the campaigns table breathe.** Once `.column` widens (or if the table is
   hoisted out of the cap to near-full width), the 11-column desktop table stops
   needing horizontal scroll (`campaigns-section.tsx:126`, `.campaignTableWrap`
   `results.module.css:489`). Consider widening the table to the data-rail/full width
   independent of the narrative column.

---

## 2. REPORTS (`/reports`)

Entry: `apps/dashboard/src/app/(auth)/(mercury)/reports/page.tsx` → `ReportsPage`
(`.../reports/reports-page.tsx`). Styles: `.../reports/reports.module.css`.
No `(mercury)/layout.tsx` — it inherits the shared `(auth)/layout.tsx` shell.

### Current Layout (FACTS)

- **Reports is genuinely desktop-built — it is NOT stretched-mobile.** It defines a
  page max-width token and applies it to every section:
  - `reports.module.css:34` — `--max-w: 74rem;` (1184px), plus `--page-x:28px`.
  - Applied via `max-width: var(--max-w); margin:0 auto` on `.topbarRow` (`:76-78`),
    `.pageHead` (`:221-223`), `.section` (`:375-377`), `.pullquoteWrap` (`:402-404`),
    `.attrBlock` (`:437-439`), `.funnel` (`:647-649`), `.tblWrap` (`:810-812`),
    `.costBlock` (`:1057-1059`), `.mcWrap` (`:1168-1170`), `.colophon` (`:1266-1268`),
    banners/skeleton (`:179, 1359, 1379, 1422`).
- **Real multi-column desktop grids throughout** (all collapse at their own
  breakpoints):
  - `.pageHead` `grid-template-columns: minmax(0,1fr) auto` → 1fr ≤860px (`:225, 229-234`).
  - `.attrSplit` Riley|Alex `grid-template-columns:1fr 1fr` → 1fr ≤720px (`:532-547`).
  - `.funnelTable` `grid-template-columns:130px minmax(0,1fr) 90px 80px`, dedicated
    mobile reflow ≤520px (`:653-661, 782-806`).
  - `.costThree` `grid-template-columns:1fr 1fr 1.35fr` → 1fr ≤860px (`:1061-1072`).
  - `.mcGrid` `1fr 1fr` → 1fr ≤860px (`:1173-1183`).
  - `.colophon` `minmax(0,1fr) auto` → 1fr ≤720px (`:1270-1280`).
- **Campaigns table** is a true wide table: `.tbl{ width:100%; min-width:920px }`
  inside `.tblScroll{overflow-x:auto}` (`:814-824`), sticky name column (`:893-915`),
  with a separate mobile card layout swapped in ≤760px (`.tblCards` hidden by
  default, `.tblScroll` hidden ≤760px) (`:991-1053`).
- Type scales fluidly with `clamp()`/`vw` (`.pageTitle` `clamp(36px,4.6vw,56px)` `:240`,
  `.attrNum` `clamp(64px,9vw,132px)` `:453`, `.costCell.saving .v` `clamp(48px,6vw,80px)`
  `:1129`).

### Desktop Opportunities (REPORTS)

Reports is largely solved; opportunities are incremental, not a rescue.

1. **Raise the ceiling on very wide screens.** `--max-w:74rem` is fixed
   (`reports.module.css:34`) with no ≥1440px step — unlike `.dashboard-frame`
   which goes to 88rem ≥1440px (`globals.css:348-352`). On 1920px+ there is still
   large dead margin. Add a ≥1440px bump to `--max-w` (e.g. 84–88rem).
2. **Section vertical rhythm vs. width.** `.section` uses 56px vertical padding
   (`:377`) and most blocks are full-width single columns stacked top-to-bottom; on
   ultrawide the page reads as a tall scroll. Optional: pair adjacent low-density
   sections (e.g. PullQuote beside Attribution-aside) into a 2-col band ≥1280px.
   Lower priority — the editorial single-column statement is intentional here.
3. **Bring the Reports pattern TO Results.** The biggest cross-screen win: Results
   should adopt this exact `--max-w` + per-section `margin:0 auto` + collapsing-grid
   approach. Reports is the working reference implementation.

---

## 3. SHEETS / DRAWERS

Shared primitive: `apps/dashboard/src/components/ui/sheet.tsx` (Radix Dialog wrapper).
Sibling: `apps/dashboard/src/components/ui/dialog.tsx`.

### Current Layout (FACTS)

- **The Sheet primitive caps every side-drawer at ~384px on desktop.**
  `sheet.tsx:36-41` `sheetVariants`:
  - `right`: `inset-y-0 right-0 h-full w-3/4 border-l ... sm:max-w-sm`
  - `left`: `inset-y-0 left-0 h-full w-3/4 border-r ... sm:max-w-sm`
  - `top`/`bottom`: `inset-x-0 ... border-b/t` (full viewport width, height = content).
    `sm:max-w-sm` = `max-width:24rem` (384px). **There is no `lg:`/`xl:` override** — a
    right/left drawer is the same ≤384px rail at 1024px and at 1920px.
- **Dialog primitive** caps modals at `max-w-lg` (32rem / 512px) centered:
  `dialog.tsx:41` `... w-full max-w-lg translate-x-[-50%] translate-y-[-50%] ...`.
  No desktop width step.

- **Agent-panel drill-in Sheet (Alex/Riley/Mira — the main read-only panel opened from
  Home / Inbox / Results):**
  `apps/dashboard/src/components/agent-panel/agent-panel.tsx`,
  styles `apps/dashboard/src/components/agent-panel/agent-panel.module.css`.
  - It is a **`side="bottom"` Sheet**, not a right side-panel:
    `agent-panel.tsx:88` `<SheetContent side="bottom" className={styles.panel}>`.
  - `.panel` (`agent-panel.module.css:25-36`): `height:92% !important`, `padding:0
!important`, rounded top corners, flex-column; **no width rule** → inherits the
    bottom-variant full viewport width. So on desktop it is a **near-fullscreen bottom
    sheet** (92% tall, 100% wide) with a mobile drag handle (`.panel::before`
    `:39-48`).
  - Internals are mobile-narrow regardless of viewport: header/sections use fixed
    `padding: … 20px` (`.idRow` `:55`, `.identityStatus` `:109`, `.decisionSection`
    `:523`, `.logSection` `:661`), hero card `margin:14px 20px` (`:282`). Body is a
    single `flex-direction:column` scroller (`.body` `:83-89`). The 56px hero number
    (`:317`) and single-column slot stack sit in a ~full-width sheet with huge empty
    flanks on desktop. **There is no `@media (min-width: …)` rule anywhere in
    `agent-panel.module.css`** — zero desktop adaptation.
  - It opens from Results here: `results-page.tsx:134-145` (`<AgentPanel side via
component>`); Home/Inbox mount it the same way (decoupled local open-state, per
    the component's own doc `agent-panel.tsx:42-64`).

- **Other right-side drawers (also mobile-width on desktop):**
  - **InboxDrawer** — `apps/dashboard/src/components/layout/inbox-drawer.tsx:121`
    `<SheetContent side="right" className="inbox-drawer sm:max-w-[28rem]">`. `28rem` =
    448px. (`.inbox-drawer` has no width rule in any `*.css` — only the Tailwind class
    sets width.) Read-mostly inbox detail, 448px max at any desktop size.
  - **Contacts detail-drawer** —
    `apps/dashboard/src/app/(auth)/(mercury)/contacts/components/detail-drawer.tsx:42`
    `<SheetContent side="right" className={styles.detailDrawer}>`. `.detailDrawer`
    (`.../contacts/pipeline.module.css:438`) sets only `background:#fff; padding:0` —
    **no width**, so it falls back to the primitive default `w-3/4 sm:max-w-sm` (384px).
    A data-dense pipeline/opportunity detail crammed into 384px on desktop.
  - **live-signal-popover** — `src/components/layout/live-signal-popover.tsx:98`
    `side="bottom"` (small status popover; not a width concern).
  - **activity-detail** — `src/components/activity/activity-detail.tsx` imports only
    `SheetHeader/Title/Description` (renders _inside_ a parent sheet; owns no
    `SheetContent`/width). Not a drawer-width owner.

- **Dialog consumers** (modal, 512px cap from primitive): settings
  `connections-list.tsx:240,264` and `whatsapp-template-create.tsx:111`
  (`max-h-[85vh] overflow-y-auto sm:max-w-lg`). Settings-domain; noted for
  completeness.

### Desktop Opportunities (SHEETS/DRAWERS)

1. **Add responsive desktop widths to the Sheet primitive.** In `sheet.tsx:39-40`,
   extend `right`/`left` variants with a desktop step, e.g.
   `... sm:max-w-sm lg:max-w-md xl:max-w-lg` (or a wider explicit `lg:w-[32rem]
xl:w-[40rem]`). One edit widens every right/left drawer at once. The 384px default
   is the single root cause of "narrow mobile drawers on desktop."
2. **Make the agent panel a right side-panel on desktop (not a bottom sheet).** Two
   viable routes:
   - **(a)** Switch `side="bottom"` → `side="right"` at ≥1024px and give `.panel` a
     desktop width (e.g. `lg:w-[28rem]`), so it reads as a contextual inspector rail
     beside the page it was opened from, instead of a fullscreen bottom takeover.
     (files: `agent-panel.tsx:88`, `agent-panel.module.css:25`).
   - **(b)** Even better for Results/Home/Inbox: on desktop render the panel **inline
     (non-overlay)** as a right column of a 2-pane layout rather than a Radix overlay
     Sheet — the component already takes plain `open/onOpenChange` props
     (`agent-panel.tsx:65-72`) and the host owns open-state, so a host could render it
     in-grid at ≥1024px and as the bottom Sheet on mobile. Removes the dark overlay +
     drag-handle affordance on desktop entirely.
3. **Widen the agent panel internals for desktop.** Its slots are a single column with
   fixed 20px gutters (`agent-panel.module.css:55,109,523,661`); at desktop width the
   KeyResult hero + OpenDecisions + WorkLog could go 2-up (decisions | work-log) via a
   `@media (min-width:1024px)` grid — the file currently has **none**.
4. **Give the contacts + inbox drawers a real desktop width.** Contacts
   `.detailDrawer` (`pipeline.module.css:438`) inherits 384px — add a width; InboxDrawer
   448px (`inbox-drawer.tsx:121`) could go wider on desktop. Both carry dense detail
   that benefits from a wider rail. (Covered automatically if opportunity #1 lands and
   they stop overriding/relying on the narrow default.)
5. **Dialog desktop width (settings, lower priority).** `dialog.tsx:41` `max-w-lg`
   could gain `lg:max-w-2xl` for the denser settings/whatsapp modals
   (`connections-list.tsx:264`, `whatsapp-template-create.tsx:111`).

---

## Summary of binding width constraints (FACTS)

| Surface                              | Desktop width today                                    | Source                                                                                       |
| ------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Results screen                       | **640px**, centered (no >768px breakpoint)             | `results.module.css:1258-1265` `.column`                                                     |
| Results campaigns table              | desktop `<table>` but trapped in 640px → h-scroll      | `campaigns-section.tsx:126`, `results.module.css:489`                                        |
| Reports screen                       | **74rem (1184px)**, real multi-col grids               | `reports.module.css:34` `--max-w` + per-section `:76,221,375,402,437,647,810,1057,1168,1266` |
| Agent panel (Alex/Riley/Mira)        | **full-width bottom sheet, 92% tall**, no desktop rule | `agent-panel.tsx:88`, `agent-panel.module.css:25-36`                                         |
| Sheet primitive (right/left drawers) | **≤384px** (`w-3/4 sm:max-w-sm`), no lg/xl             | `sheet.tsx:39-40`                                                                            |
| Inbox drawer                         | **≤448px** (`sm:max-w-[28rem]`)                        | `inbox-drawer.tsx:121`                                                                       |
| Contacts detail drawer               | **≤384px** (inherits primitive default)                | `detail-drawer.tsx:42`, `pipeline.module.css:438`                                            |
| Dialog modals                        | **≤512px** (`max-w-lg`)                                | `dialog.tsx:41`                                                                              |

Shell envelope these sit inside is generous (`.page-width` 74rem, `.dashboard-frame`
76→88rem): `globals.css:324,334,350`. Every cap above is the screen's own choice, not
the shell.
