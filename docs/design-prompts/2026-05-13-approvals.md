# Claude Design Prompt — /approvals

Generated 2026-05-13. Backend-verified against `packages/schemas/src/approval-lifecycle.ts`, `packages/schemas/src/risk.ts`, `apps/api/src/routes/approvals.ts`. No `/approvals` page UI exists yet — greenfield.

---

Design the /approvals page for "Switchboard" — a governed operator dashboard for a Singapore medspa operator. This is the single cross-agent queue where the operator decides whether each agent-proposed mutating action should proceed. Greenfield: no existing UI to migrate.

## Domain (matches real schema at packages/schemas/src/approval-lifecycle.ts and risk.ts)

A PendingApproval row from GET /api/approvals/pending has:

- id: string
- summary: string (short prose, what the agent wants to do)
- riskCategory: "none" | "low" | "medium" | "high" | "critical"
- status: "pending" | "approved" | "rejected" | "expired" | "superseded" | "recovery_required"
- envelopeId: string
- expiresAt: ISO timestamp (approval auto-expires; show countdown)
- bindingHash: string (cryptographic — must be visible to operator before approving)
- createdAt: ISO timestamp

ApprovalDetail (GET /api/approvals/:id) adds:

- request.approvers[] — when quorum applies, list of approvers + thresholds
- state.respondedBy / respondedAt — set after action

The operator responds via POST /api/approvals/:id/respond with one of:

- "approve" — proceed with the action (requires bindingHash echo)
- "reject" — block the action
- "patch" — modify parameters (patchValue: Record<string,unknown>, ≤100KB) then approve the modified version. This is the most operator-empowering path and must feel first-class, not buried.

Quorum: some approvals require N approvers; display "2 of 3 approved" state. Duplicate approvers are rejected by the API.

## Design system (verified in apps/dashboard/src/app/globals.css)

CSS vars to use:

- --sw-base: #F5F3F0 (warm off-white background)
- --sw-surface: #EDEAE5, --sw-surface-raised: #F9F8F6
- --sw-border: #DDD9D3, --sw-border-strong: #C8C3BC
- --sw-text-primary: #1A1714, --sw-text-secondary: #6B6560, --sw-text-muted: #9C958F
- --sw-accent: #A07850 (operator amber — reserve for approve CTA only)
- --duration-default: 280ms, --ease-standard: cubic-bezier(0.4,0,0.2,1)

Fonts: --font-display "Instrument Sans" (headings), --font-sans "Inter" (body). Mono font for IDs / binding hashes / envelopeId.

## Layout

Two-pane page on desktop, stacked on mobile:

- LEFT: Queue list. Each row = one PendingApproval.
- RIGHT: Selected approval detail panel (full ApprovalDetail).
- Top of page: lightweight filter strip (riskCategory chip toggles: all / low / medium / high / critical; "expiring soon" toggle <60min remaining).

## Row design (queue)

- Risk indicator (left-edge): subtle hairline tint by riskCategory — muted for low, amber-warm for medium, deeper amber for high, near-black hairline for critical. NO red/yellow/green status dots, NO emoji, NO bright fills.
- Summary: primary text, font-display, 1–2 lines, truncated.
- Meta line: "Expires in 23m · created 4m ago · agent: alex"
- Quorum chip if applicable: "1 of 2"
- Hover: row gains --sw-surface-raised; transition 280ms ease-standard.

## Detail panel (right)

Four blocks in order:

1. Header — summary (display font), riskCategory pill, expiry countdown (live updating).
2. Binding Hash card — full hash in mono, 11px section-label "INTEGRITY CHECK", copy button. Compact, but cannot be hidden behind a click. This is the integrity contract.
3. Approvers (if quorum) — list of approver IDs with timestamp; "you have not approved yet" affordance; "1 more required" hint.
4. Action drawer — three actions in this priority order:
   - Approve (primary amber CTA — must show "I confirm hash 0x1a2b..." inline so operator commits to the hash, not just clicks "yes")
   - Patch — opens a JSON editor for patchValue with a side-by-side diff against parametersSnapshot; when submitted, applies patch then approves
   - Reject — quiet outline button, requires no hash, optional reason field

## State coverage

- Loading: skeleton rows; no spinner.
- Empty: calm "Nothing waiting" with last-cleared timestamp.
- Error: inline banner, not a full-page replace.
- Expired-during-view: row dims, detail shows "expired 12s ago", no action buttons.
- Recovery_required: distinct treatment (subtle striped border, info caption explaining a re-run is needed before approval can proceed).

## Anti-patterns

- No red/green status traffic lights. Risk is communicated by hairline weight and amber depth, not RGB warning colors.
- No "approve all" mega-button. Each approval is one decision.
- Don't bury the binding hash behind an accordion.
- Don't use Material/Fluent style — this is editorial-utilitarian, not SaaS.

## Deliverable

Single React + Tailwind page with the two-pane layout + queue row component + detail panel. Realistic fixtures: 9–12 PendingApprovals mixing risk categories, 2 with quorum (one at 1/2, one at 2/3), one within 5 minutes of expiry, one in recovery_required state. Include a worked example for the patch flow with a fake parametersSnapshot.
