# Console Redesign — Phase 2 (Queue Inline Interaction + HaltProvider)

**Status:** Draft
**Date:** 2026-05-03
**Scope:** `apps/dashboard/src/components/console/` — switch the queue from slide-over actions to inline interaction (transcript reveal, inline approve/reject, fade-out resolve animation), and lift Halt state into a `<HaltProvider>` context.
**Amends:** [`2026-05-02-console-frame-phase-1-design.md`](./2026-05-02-console-frame-phase-1-design.md) — Phase 1 deferred the queue-interaction swap and the HaltProvider lift to this phase.
**Defers:** Phase 3 (Agent expandable panels — Nova/Alex/Mira), Phase 4 (Activity filters + CTA-jump-to-queue + flash-on-new), and the **real backend Halt** (org-wide pause endpoint behind the existing visual-only Halt button).

## Background

After Phase 1 lands, `/console` ships the static frame: OpStrip with live clock + Halt + Help, dismissible Welcome banner, Help overlay, Toast shelf, working keyboard shortcuts. The queue zone still uses the legacy slide-over interaction model:

1. Operator clicks "Reply inline ▾" or the primary button on a card → a slide-over opens from the right.
2. They take the action inside the slide-over → it closes.
3. The card list is invalidated and re-fetches.

This forces the operator out of context: the surrounding queue, agent strip, and activity trail are obscured by the slide-over's overlay. The original `claude.ai/design` chat-6 bundle the user finalized (Console.html / console.css / console-app.jsx) treats the queue card itself as the action surface — no overlay. The "Reply inline ▾" caret was always intended to expand a reply panel **inside the card**, not open a panel beside it.

Phase 1 also shipped a deliberate compromise on Halt state. `useHaltState` is a per-component `useState` + `localStorage` hook with two consumers (`OpStrip` for the button + halted styling, `ConsoleView` for the `H` keyboard shortcut). Each consumer holds its own copy of the boolean; only the local copy re-syncs on its own render, so the second click's snapshot can diverge between them. The Phase 1 mitigation was a DOM querySelector shim — `ConsoleView`'s keyboard handler does `document.querySelector<HTMLButtonElement>(".op-halt")?.click()` to delegate to OpStrip's authoritative state. Reviewer flagged the lift to a `<HaltProvider>` as the Phase 2 cleanup target.

Phase 2 closes both gaps in one PR.

## Goal

After Phase 2 lands, an operator on `/console` sees:

1. **Halt as a single source of truth.** OpStrip's Halt button and the `H` keyboard shortcut share one piece of state via `useHalt()`. The DOM querySelector workaround is gone. Toggling Halt either way produces exactly one undoable toast.
2. **Queue actions resolve inline.** Clicking "Reply inline ▾" on an Escalation card expands a transcript + reply panel **above** the card's action buttons. The buttons themselves call the same shared mutation hooks the slide-overs used (`useEscalationReply`, `useApprovalAction`).
3. **Resolved cards fade out.** When an action succeeds — escalation reply sent, approval gate approved or rejected, recommendation acted on or dismissed — the card animates out (220ms opacity + translateY, 320ms max-height collapse) before the query invalidation re-renders the list. The next card in the queue rises to fill the gap without a jarring jump.
4. **Errors stay inline.** A 502 on escalation reply preserves the textarea text and shows the channel-aware failure copy under the Send button (matching `/escalations` behavior). An approval mutation failure shows the error inline above the Approve/Reject buttons.
5. **Slide-overs are gone.** The `slide-overs/` directory is deleted; the shared mutation hooks remain (used by `/escalations` and `/decide` too).

## Non-goals (deferred to later phases)

- **Real backend Halt** — Phase 2 keeps Halt visual-only. The toast still says "all agents halted — actions queued." Wiring a real org-wide pause endpoint is its own spec; the toast copy is acceptable in the interim because the backend will eventually honor the queued claim.
- **Recommendation card backend** — Recommendations on `/console` today have no real action endpoints. Phase 2 keeps recommendation primary/secondary/dismiss as visual-only (fire toast + fade-out). When the recommendation backend lands, swap the no-op handlers for real mutations under the same fade-out behavior.
- **Agent strip expand-to-panel** (Phase 3).
- **Activity-row CTA jump-to-queue + flash-on-new** (Phase 4).
- **Full threaded conversation rendering with timestamps + lead context** beyond what `useEscalationDetail` already returns. The `/conversations/[id]` page remains the place to go for the full thread; Phase 2 surfaces enough of the transcript to make an inline reply decision.

## Architecture

### Halt state — single source via context

Replace `apps/dashboard/src/components/console/use-halt-state.ts` with `apps/dashboard/src/components/console/halt-context.tsx`:

```tsx
type HaltContextValue = {
  halted: boolean;
  setHalted: (next: boolean) => void;
  toggleHalt: () => void;
};

const HaltContext = createContext<HaltContextValue | null>(null);

export function HaltProvider({ children }: { children: React.ReactNode }) {
  const [halted, setHaltedState] = useState<boolean>(() => readLocal());
  useEffect(() => {
    writeLocal(halted);
  }, [halted]);
  const value = useMemo(
    () => ({
      halted,
      setHalted: setHaltedState,
      toggleHalt: () => setHaltedState((v) => !v),
    }),
    [halted],
  );
  return <HaltContext.Provider value={value}>{children}</HaltContext.Provider>;
}

export function useHalt(): HaltContextValue {
  const ctx = useContext(HaltContext);
  if (!ctx) throw new Error("useHalt must be used inside <HaltProvider>");
  return ctx;
}
```

`readLocal` / `writeLocal` keep the existing SSR guards and `sb_halt_state` localStorage key. The provider wraps `<ConsoleView>` (alongside the existing `<ToastProvider>` from Phase 1). Both `OpStrip` and `ConsoleView`'s keyboard handler call `useHalt()`; neither holds its own state copy. The `document.querySelector(".op-halt")?.click()` shim in `ConsoleView` is removed — the keyboard handler calls `toggleHalt()` directly and fires its own undoable toast via `useToast()`.

The Phase 1 race is structurally impossible after this change. Tests verify both consumers reflect the same state across multiple toggles.

### Queue interaction — inline reveal, fade-out resolve

The queue card view splits into per-kind files under `apps/dashboard/src/components/console/queue-cards/`. Each card kind owns its own state and its own mutation wiring:

```
queue-cards/
├── index.tsx              # QueueCardView dispatcher + re-exports
├── rich-text.tsx          # RichTextSpan (extracted from current queue-cards.tsx)
├── escalation-card.tsx    # EscalationCardView + inline transcript + reply
├── recommendation-card.tsx # RecommendationCardView + visual-only handlers
└── approval-gate-card.tsx # ApprovalGateCardView + inline approve/reject
```

The split is required: each kind needs to embed its own mutation state, expansion state (escalation only), and inline error state. Keeping all three in one file would push past the 400-line CLAUDE.md soft warn after the inline reply panel + error UI lands.

Every card root carries `id={`q-${card.id}`}` — Phase 1's spec called these out as the scroll-target prereq for Phase 3 Nova cross-links ("Drafting pause on Whitening Ad Set B — approve in queue above ↑") and Phase 4 activity-row CTAs.

#### Escalation card — inline transcript + reply

Current behavior: `Reply inline ▾` is a styled link with a caret; `onPrimary` opens a slide-over.

New behavior: clicking `Reply inline ▾` toggles a local `expanded: boolean`. When expanded, the card renders a `<TranscriptPanel>` between `.esc-issue` and `.qactions`:

```tsx
{
  expanded && (
    <div className="esc-panel">
      <TranscriptPanel escalationId={card.escalationId} />
      <ReplyForm
        escalationId={card.escalationId}
        channelName={card.channel}
        onSent={() => beginResolve(card.id)}
      />
    </div>
  );
}
```

`<TranscriptPanel>` calls `useEscalationDetail(escalationId)` (the same hook `/escalations` uses). It renders the last N messages from `data.conversationHistory` as alternating `lead` / `agent` / `owner` rows with timestamps, and a footer link `Open full conversation →` to `/conversations/${escalationId}`. While loading: a small skeleton (3 muted rows). On error: a minimal "Couldn't load transcript — open full conversation" fallback link. **N = 5** (most recent 5 messages, oldest-to-newest).

`<ReplyForm>` is a self-contained form:

- Local `text` state (textarea), `error` state.
- Calls `useEscalationReply(escalationId).send(text)` on submit.
- On 200: clears the textarea and calls `onSent()` to start the fade-out resolve.
- On 502: preserves the textarea, sets `error = "Couldn't deliver to {channelName} right now — {upstream message}"` (matches `/escalations` copy verbatim).
- On thrown error: preserves the textarea, sets `error = err.message`.

The card's `.qactions` row (primary / secondary / self-handle buttons) stays where it is, **below** the expanded panel. The primary button still calls the same `useEscalationReply.send(...)` — but now via a default-message path (the existing primary action label e.g. "Send templated reply") fires the same mutation without expanding the form. If the operator wants to write a custom reply, they expand the panel first. The two paths converge on the same `onSent` resolve animation.

If `card.primary.label` semantics change in future (i.e. the primary becomes "Mark resolved" instead of "Send reply"), this design extends naturally — the inline panel handles reply, the button handles direct resolution, both fade the card on success.

#### Recommendation card — visual-only inline

Recommendations have no backend wiring today. Phase 2 keeps them visual-only:

- `primary` / `secondary` / `dismiss` each fire a toast via `useToast().showToast({ title, detail, undoable: false })`.
- All three start the fade-out resolve animation via the same `beginResolve(card.id)` hook.
- The toast is **not undoable** (no real action to roll back), and the card disappears from the local `resolvingIds` set after the fade — but **does not** invalidate the query, since the underlying recommendation list isn't backed by a mutating API yet. The card reappears on next refetch.

This matches the "visual-only with toast" pattern Phase 1 established for Halt and is the most honest representation of unimplemented backend functionality. When the recommendation backend lands, swap the no-op handlers for real mutations and add invalidation.

#### Approval gate card — inline approve / reject

Current behavior: primary button opens `<ApprovalSlideOver>` which exposes Approve and Reject; the slide-over calls `useApprovalAction.approve(bindingHash)` / `.reject(bindingHash)`.

New behavior: the card's primary button label remains as in `card.primary.label` (e.g. "Approve at stage 2"); a new secondary "Reject" button appears in `.qactions`. Both buttons:

- Set `pending: true` (button disabled, subtle spinner via existing `.btn[disabled]` styling).
- Call the matching mutation directly with `card.bindingHash`.
- On success: clear `pending`, call `beginResolve(card.id)`, the card fades and is removed.
- On error: clear `pending`, set inline `error` displayed in a `.qerror` row above `.qactions` ("Approval failed — {message}"). The card stays put; the operator can retry.

The existing `stop` side button (kills the underlying job) is preserved as-is. It already has no slide-over; it stays a no-op visual button until its own backend wiring spec.

### Fade-out resolve animation

`<QueueZone>` owns a `resolvingIds: Set<string>` state. When any card calls the prop callback `onResolve(cardId)`:

1. `setResolvingIds(prev => new Set(prev).add(cardId))`.
2. The card's root receives `className={`qcard ... ${resolving ? "is-resolving" : ""}`}`.
3. After 320ms (`setTimeout`), `queryClient.invalidateQueries(...)` runs for both `escalations.all` and `approvals.pending`. The card disappears on next render. The `resolvingIds` set is also cleared for that id (so if the card persists due to upstream lag, it doesn't stay frozen mid-fade).

CSS in `console.css` (scoped under `[data-v6-console]`):

```css
[data-v6-console] .qcard {
  transition:
    opacity 220ms ease,
    transform 220ms ease,
    max-height 320ms ease,
    margin 320ms ease,
    padding 320ms ease;
  overflow: hidden;
}
[data-v6-console] .qcard.is-resolving {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
  margin-top: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  pointer-events: none;
}
```

The `max-height` collapse pulls the next card up smoothly. `pointer-events: none` prevents click-through to a card mid-fade. Honoring `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  [data-v6-console] .qcard,
  [data-v6-console] .qcard.is-resolving {
    transition: none;
  }
}
```

Reduced-motion users still get the fade endpoint (display: none equivalent — card is removed by query invalidation at 320ms), just without the in-between animation.

### Optimistic UI scope

We deliberately do not touch React Query's cache before the server confirms. The 220ms fade is shorter than nearly all reply / approve roundtrips; perceived speed is good without optimistic cache prediction. On error, the card's inline error reverts UI cleanly without requiring rollback. Stay simple.

### Slide-over removal

Delete in the same PR:

- `apps/dashboard/src/components/console/slide-overs/escalation-slide-over.tsx`
- `apps/dashboard/src/components/console/slide-overs/approval-slide-over.tsx`
- `apps/dashboard/src/components/console/slide-overs/console-slide-over.tsx`
- `apps/dashboard/src/components/console/slide-overs/__tests__/` (entire directory)

Verified: `console-slide-over.tsx` is only imported by the two console slide-overs being deleted (grep across `apps/dashboard/src/`).

Keep:

- `apps/dashboard/src/hooks/use-escalation-reply.ts` (used by `/escalations`).
- `apps/dashboard/src/hooks/use-approval-action.ts` (used by `/decide` list and detail).
- The `useEscalationDetail` hook in `use-escalations.ts` (used by `/escalations` and now console).

### `<ConsoleView>` changes

```tsx
<HaltProvider>
  <ToastProvider>
    <div data-v6-console>
      <OpStrip onHelpOpen={() => setHelpOpen(true)} />
      <main className="console-main">
        <WelcomeBanner />
        <QueueZone /> {/* prop `onOpenSlideOver` removed */}
        <AgentStrip />
        <NovaPanel />
        <ActivityTrail />
      </main>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      <ToastShelf />
    </div>
  </ToastProvider>
</HaltProvider>
```

Removed:

- `slideOver` `useState` and the conditional `<ApprovalSlideOver>` / `<EscalationSlideOver>` renders.
- The slide-over imports.

The keyboard handler for Halt simplifies:

```ts
useKeyboardShortcuts({
  help: () => setHelpOpen((v) => !v),
  halt: () => {
    const wasHalted = halted; // from useHalt()
    toggleHalt();
    showToast({
      title: wasHalted ? "RESUMED" : "HALTED",
      detail: wasHalted ? "agents resumed" : "all agents halted — actions queued",
      undoable: true,
      onUndo: () => setHalted(wasHalted),
    });
  },
  escape: () => setHelpOpen(false),
});
```

The querySelector workaround is gone. `OpStrip`'s click handler also calls `toggleHalt()` + `showToast(...)` with the same undoable toast — the duplication is intentional and minor (5 lines), and centralizing it would require a `haltAndToast()` helper that obscures the relationship between Halt and its toast at each call site. Two call sites is acceptable; a third would justify extraction.

### `<QueueZone>` changes

Props change: `onOpenSlideOver` removed; replaced by internal `resolvingIds` state and `queryClient.invalidateQueries` calls.

```tsx
export function QueueZone() {
  const escalations = useEscalations();
  const approvals = useApprovals();
  const queryClient = useQueryClient();
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(() => new Set());

  const beginResolve = useCallback(
    (cardId: string) => {
      setResolvingIds((prev) => {
        const next = new Set(prev);
        next.add(cardId);
        return next;
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.escalations.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.approvals.pending() });
        setResolvingIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }, 320);
    },
    [queryClient],
  );

  // ... loading / error / empty branches unchanged ...

  return (
    <section aria-label="Queue">
      <div className="queue-head">
        <Link className="label" href="/escalations">
          Queue
        </Link>
        <span className="count">{cards.length} pending</span>
      </div>
      <div className="queue">
        {cards.map((card) => (
          <QueueCardView
            key={card.id}
            card={card}
            resolving={resolvingIds.has(card.id)}
            onResolve={() => beginResolve(card.id)}
          />
        ))}
      </div>
    </section>
  );
}
```

The 320ms timer matches the longest CSS transition on `.qcard.is-resolving`. If a unit test needs to skip the timer, vitest's `vi.useFakeTimers()` + `vi.advanceTimersByTime(320)` works.

## CSS additions

All new rules go in `apps/dashboard/src/components/console/console.css` under `[data-v6-console]`:

- `.qcard` transition + `.is-resolving` collapse keyframe (above).
- `.esc-panel` — bordered container above `.qactions` holding `<TranscriptPanel>` + `<ReplyForm>`. Spec: `padding: 0.85rem 0`, `border-top: 1px dashed var(--c-hair)`, `margin-bottom: 1rem`.
- `.transcript-row` — alternating left/right alignment per role (`.role-lead` left, `.role-agent` / `.role-owner` right), small avatar circle + role label, message body with mono timestamp. Reuse existing token vars (`--c-text-2`, `--c-text-3`, `--c-coral` for owner messages).
- `.transcript-empty` / `.transcript-loading` / `.transcript-error` — small muted states.
- `.reply-form` — textarea (3 rows, full width, `--c-hair` border), Send button (uses existing `.btn-primary-graphite`), `.reply-error` (coral text).
- `.qerror` — coral text inline above `.qactions` for approval failures.
- `prefers-reduced-motion` query for `.qcard` transitions.

The existing `.esc-reply` caret styling (rotates on expand) gets a small addition: `.esc-reply.is-open .caret { transform: rotate(180deg); }`.

## Removals

- `apps/dashboard/src/components/console/use-halt-state.ts` — replaced by `halt-context.tsx`.
- `apps/dashboard/src/components/console/slide-overs/` — entire directory.
- `apps/dashboard/src/components/console/queue-cards.tsx` — replaced by `queue-cards/` directory. (The directory's `index.tsx` re-exports the same `QueueCardView` symbol so consumers do not need to change their imports beyond the path.)
- The `onOpenSlideOver` prop on `<QueueZone>` — gone.
- The `slideOver` state + conditional rendering in `<ConsoleView>` — gone.

## Tests

Per CLAUDE.md, every new module ships a co-located test. Vitest + React Testing Library. Coverage target stays 55/50/52/55.

| Module                                                                      | Tests                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `halt-context.tsx`                                                          | provider exposes `halted`/`setHalted`/`toggleHalt`; reads localStorage on mount; writes on change; `useHalt()` outside provider throws; multiple consumers reflect the same state across rapid toggles (regression test for the Phase 1 race)                                                                                                                                                                       |
| `queue-cards/escalation-card.tsx`                                           | clicking `Reply inline ▾` toggles `expanded`; expanded shows `<TranscriptPanel>` + `<ReplyForm>` above `.qactions`; primary button calls `useEscalationReply.send` then `onResolve`; `<ReplyForm>` Send 200 clears textarea + calls `onResolve`; 502 keeps text + shows channel-aware error; thrown error keeps text + shows error message; primary mutation success calls `onResolve`; collapsed state hides panel |
| `queue-cards/recommendation-card.tsx`                                       | primary fires toast + `onResolve`; secondary fires toast + `onResolve`; dismiss fires toast + `onResolve`; toasts are non-undoable; no mutation called                                                                                                                                                                                                                                                              |
| `queue-cards/approval-gate-card.tsx`                                        | primary calls `useApprovalAction.approve(bindingHash)` then `onResolve`; reject calls `.reject(bindingHash)` then `onResolve`; both disable buttons during pending; failure shows `.qerror` row + leaves card in place; stop button is rendered but unwired                                                                                                                                                         |
| `queue-cards/index.tsx`                                                     | dispatcher routes `kind: 'escalation'                                                                                                                                                                                                                                                                                                                                                                               | 'recommendation' | 'approval_gate'`to the correct card; passes`resolving`and`onResolve` through |
| `zones/queue-zone.tsx` (updated)                                            | `onResolve` adds to `resolvingIds`; card receives `is-resolving` class while in set; after 320ms, query invalidation called and id removed from set; loading / error / empty branches unchanged from Phase 1                                                                                                                                                                                                        |
| `console-view.tsx` (updated)                                                | renders `<HaltProvider>` outside `<ToastProvider>`; no slide-over rendered; keyboard `H` toggles halt + fires undoable toast (regression test for the Phase 1 querySelector workaround being removed); halt state is shared between OpStrip click and keyboard `H` (no race)                                                                                                                                        |
| `transcript-panel.tsx` (new helper inside `escalation-card.tsx` or sibling) | renders most recent 5 messages from `useEscalationDetail` data; loading / error / empty states; "Open full conversation →" link href correct                                                                                                                                                                                                                                                                        |
| `reply-form.tsx` (new helper)                                               | textarea controlled; Send disabled while pending; 200 clears + calls `onSent`; 502 sets channel-aware error + preserves text; thrown error path; matches `/escalations` `EscalationCard.handleSend` behavior                                                                                                                                                                                                        |

Existing tests to update:

- `console-view.test.tsx` — drop slide-over assertions, add HaltProvider wrap.
- `console-view-halt.test.tsx` — remove `.op-halt`-querySelector assumption; verify single-source state behavior instead.
- `queue-cards.test.ts` — port to per-kind test files; old file deleted.

Tests to delete:

- `slide-overs/__tests__/console-slide-over.test.tsx`
- `slide-overs/__tests__/escalation-slide-over.test.tsx`
- `slide-overs/__tests__/approval-slide-over.test.tsx`
- `use-halt-state.test.ts` (the hook is deleted; provider replaces it)

## Acceptance criteria

A reviewer running `pnpm dev` (with seeded queue data) and opening `/console`:

1. ☐ The queue shows escalation, recommendation, and approval-gate cards as before.
2. ☐ On an Escalation card, clicking `Reply inline ▾` expands a transcript panel showing the last ~5 messages and a reply textarea + Send button. The caret rotates 180°.
3. ☐ Sending a reply (success path) fades the card out (~220ms opacity drop, the next card slides up over ~320ms), and the card is gone after invalidation.
4. ☐ Sending a reply (delivery 502 path) preserves the textarea text and shows an inline error like "Couldn't deliver to email right now — channel delivery failed."
5. ☐ Clicking the primary button on an Approval Gate card approves the gate via `useApprovalAction.approve(bindingHash)`. Card fades out on success.
6. ☐ A new Reject button on the Approval Gate card calls `.reject(bindingHash)`. Card fades out on success. Failure shows an inline error row.
7. ☐ Recommendation primary / secondary / dismiss buttons each fire a non-undoable toast and the card fades out (next refetch may bring it back — visual-only).
8. ☐ Halt button in OpStrip toggles halted state. The `H` keyboard shortcut toggles the same state — toggling twice rapidly via mixed inputs (button → keyboard → button) ends in the correct state every time. The querySelector workaround is gone (search the source: zero matches for `.op-halt"?.click` or `querySelector<HTMLButtonElement>`).
9. ☐ The `slide-overs/` directory is deleted; `apps/dashboard/src/components/console/use-halt-state.ts` is deleted.
10. ☐ Each queue card's root has `id="q-${card.id}"` for Phase 3/4 cross-link targets.
11. ☐ `prefers-reduced-motion: reduce` disables the fade animation; cards still resolve correctly.
12. ☐ `pnpm --filter @switchboard/dashboard test` passes.
13. ☐ `pnpm --filter @switchboard/dashboard typecheck` passes.
14. ☐ `pnpm --filter @switchboard/dashboard lint` passes.
15. ☐ No file in `apps/dashboard/src/components/console/` exceeds 400 lines (CLAUDE.md soft cap).

## Risks

- **Stale `resolvingIds` after rapid actions.** If a card resolves and a new card with the same id appears before the 320ms timer fires (extremely unlikely given the id format), the new card would render mid-fade. Mitigation: `beginResolve` clears the id from the set inside the same setTimeout, and React Query invalidation runs in the same tick — the gap is theoretical. A test asserts the post-resolve set is empty.
- **`useEscalationDetail` cache pollution.** Multiple console cards expanded simultaneously trigger N parallel detail fetches. The hook is keyed by escalation id and React Query dedupes — same as `/escalations` today. No change needed.
- **Z-index / scroll jank during fade.** The collapsing `max-height` on a card forces neighboring cards to reflow. Tested informally via the existing `console.css` tokens; the effect is the intended "next card rises to fill" behavior. If smoothness suffers in real dev, fall back to `display: grid` + `gap` collapse on the queue container — out of scope for spec change.
- **`prefers-reduced-motion` correctness.** The CSS `transition: none` only suppresses the animation; the card is still removed via query invalidation. A unit test mocks `matchMedia` to verify behavior parity.
- **Halt context regression cost.** Lifting state forces every consumer (OpStrip, keyboard handler, any future consumer) to render under `<HaltProvider>`. Tests provide explicit setup helpers. The OpStrip test gets a tiny `renderWithHalt(ui)` helper.
- **Slide-over deletion regret.** No flag, no fallback. Mitigation: full inline-mode test parity before deletion; if a regression appears post-merge, revert the PR (reversibility is high for a UI change on a pre-launch surface). CLAUDE.md explicitly disallows backwards-compat shims for code we can simply change.

## Open questions

None at this time. Halt-backend, recommendation-backend, and full threaded-transcript rendering are explicit deferrals to their own future specs.

## Out-of-scope follow-ups (track when Phase 3 / Phase 5 begins)

- **Real backend Halt** (own spec): wire the OpStrip halt button to a future org-wide `POST /api/dashboard/halt` endpoint. Toast copy "actions queued" requires the backend to honor the queue claim.
- **Recommendation card backend** (own spec): replace the visual-only handlers with real mutations.
- **Full threaded transcript rendering** (Phase 3 candidate): currently `<TranscriptPanel>` shows the last 5 messages from `useEscalationDetail`. If product wants threaded scroll + lead-context summary inline, expand under the same caret-toggle.
- **Phase 3 cross-link scroll-to-card** can use the `id="q-${card.id}"` attributes Phase 2 adds.
- **Phase 4 activity-row CTA jump-to-queue** uses the same ids.
