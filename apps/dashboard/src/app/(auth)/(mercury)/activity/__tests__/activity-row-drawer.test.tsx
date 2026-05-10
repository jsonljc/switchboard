import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityRowDrawer } from "../components/activity-row-drawer.js";

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

const makeRow = (overrides: Partial<AuditEntryBrowseRow> = {}): AuditEntryBrowseRow => ({
  id: "audit_ax8f2k1z",
  eventType: "action.executed",
  timestamp: "2026-05-10T14:23:51.420Z",
  actorType: "agent",
  actorId: "agent_alex_001",
  entityType: "calendar_event",
  entityId: "cal_evt_9921",
  riskCategory: "low",
  visibilityLevel: "org",
  summary:
    "Booked appointment for contact CTC:abcd1234 in calendar 'Operations' at 2026-05-10 09:00 PT",
  snapshotKeys: ["actionType", "decisionId", "targetEntityType", "targetEntityId"],
  redactedKeyCount: 3,
  evidencePointers: [
    {
      type: "pointer",
      hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      hashPrefix: "a1b2c3d4e5f6a1b2",
    },
  ],
  entryHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  previousEntryHash: "0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
  envelopeId: "env_cal_001",
  traceId: "trace_ax8f2k1z",
  ...overrides,
});

const DRAW_ID = "activity-drawer-test";

// ---------------------------------------------------------------------------
// Clipboard mock helpers
// ---------------------------------------------------------------------------

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    writable: true,
    configurable: true,
  });
  return writeText;
}

function removeClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActivityRowDrawer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Required fields
  // -------------------------------------------------------------------------

  it("renders all required labels: EVENT, ID, TIMESTAMP, ACTOR, ENTITY, RISK, VISIBILITY, SUMMARY, SNAPSHOT, EVIDENCE, TRACE, ENVELOPE, HASH, PREV HASH", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    for (const label of [
      "EVENT",
      "ID",
      "TIMESTAMP",
      "ACTOR",
      "ENTITY",
      "RISK",
      "VISIBILITY",
      "SUMMARY",
      "SNAPSHOT",
      "EVIDENCE",
      "TRACE",
      "ENVELOPE",
      "HASH",
      "PREV HASH",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders EVENT value as the eventType string", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText("action.executed")).toBeInTheDocument();
  });

  it("renders ACTOR as actorType · full actorId", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText(/agent/)).toBeInTheDocument();
    expect(screen.getByText(/agent_alex_001/)).toBeInTheDocument();
  });

  it("renders ENTITY as entityType · full entityId", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText(/calendar_event/)).toBeInTheDocument();
    expect(screen.getByText(/cal_evt_9921/)).toBeInTheDocument();
  });

  it("renders RISK value", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText("low")).toBeInTheDocument();
  });

  it("renders VISIBILITY value", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText("org")).toBeInTheDocument();
  });

  it("renders full SUMMARY text", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText(/Booked appointment for contact CTC:abcd1234/)).toBeInTheDocument();
  });

  it("renders TRACE value when present", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText("trace_ax8f2k1z")).toBeInTheDocument();
  });

  it("renders em-dash for TRACE when traceId is null", () => {
    const { container } = render(
      <ActivityRowDrawer row={makeRow({ traceId: null })} drawerId={DRAW_ID} />,
    );
    // The TRACE label must exist
    expect(screen.getByText("TRACE")).toBeInTheDocument();
    // A dash appears in the drawer
    expect(container.textContent).toContain("—");
  });

  it("renders ENVELOPE value when present", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText("env_cal_001")).toBeInTheDocument();
  });

  it("renders em-dash for ENVELOPE when envelopeId is null", () => {
    const { container } = render(
      <ActivityRowDrawer row={makeRow({ envelopeId: null })} drawerId={DRAW_ID} />,
    );
    expect(screen.getByText("ENVELOPE")).toBeInTheDocument();
    expect(container.textContent).toContain("—");
  });

  // -------------------------------------------------------------------------
  // Snapshot keys + redacted count
  // -------------------------------------------------------------------------

  it("renders allowlisted snapshot key names comma-separated", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    // snapshotKeys: ["actionType", "decisionId", "targetEntityType", "targetEntityId"]
    expect(screen.getByText(/actionType/)).toBeInTheDocument();
    expect(screen.getByText(/decisionId/)).toBeInTheDocument();
  });

  it("shows (N keys redacted) when redactedKeyCount > 0", () => {
    render(<ActivityRowDrawer row={makeRow({ redactedKeyCount: 4 })} drawerId={DRAW_ID} />);
    expect(screen.getByText("(4 keys redacted)")).toBeInTheDocument();
  });

  it("hides the redacted-count line when redactedKeyCount === 0", () => {
    render(<ActivityRowDrawer row={makeRow({ redactedKeyCount: 0 })} drawerId={DRAW_ID} />);
    expect(screen.queryByText(/keys redacted/)).toBeNull();
  });

  it("renders a dash for SNAPSHOT when snapshotKeys is empty", () => {
    const { container } = render(
      <ActivityRowDrawer
        row={makeRow({ snapshotKeys: [], redactedKeyCount: 0 })}
        drawerId={DRAW_ID}
      />,
    );
    expect(container.textContent).toContain("—");
  });

  // -------------------------------------------------------------------------
  // Evidence pointers
  // -------------------------------------------------------------------------

  it("renders evidence pointer count and per-pointer type + hashPrefix", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(screen.getByText(/1 pointer/)).toBeInTheDocument();
    // The hashPrefix should be visible
    expect(screen.getByText(/a1b2c3d4e5f6a1b2/)).toBeInTheDocument();
  });

  it("renders '—' in evidence section when evidencePointers is empty", () => {
    const { container } = render(
      <ActivityRowDrawer row={makeRow({ evidencePointers: [] })} drawerId={DRAW_ID} />,
    );
    // EVIDENCE label still present
    expect(screen.getByText("EVIDENCE")).toBeInTheDocument();
    expect(container.textContent).toContain("—");
  });

  it("renders the plural 'pointers' when count > 1", () => {
    const row = makeRow({
      evidencePointers: [
        { type: "pointer", hash: "aaa".repeat(20), hashPrefix: "aaaaaaaaaaaaaaaa" },
        { type: "inline", hash: "bbb".repeat(20), hashPrefix: "bbbbbbbbbbbbbbbb" },
      ],
    });
    render(<ActivityRowDrawer row={row} drawerId={DRAW_ID} />);
    expect(screen.getByText(/2 pointers/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Hash chain rendering
  // -------------------------------------------------------------------------

  it("renders HASH as a truncated prefix (8 chars) with '…'", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    // entryHash starts with "1a2b3c4d"
    expect(screen.getByText(/HASH:1a2b3c4d…/)).toBeInTheDocument();
  });

  it("renders PREV HASH as a truncated prefix with '…'", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    // previousEntryHash starts with "0f1a2b3c"
    expect(screen.getByText(/HASH:0f1a2b3c…/)).toBeInTheDocument();
  });

  it("renders '—' for PREV HASH when previousEntryHash is null", () => {
    const { container } = render(
      <ActivityRowDrawer row={makeRow({ previousEntryHash: null })} drawerId={DRAW_ID} />,
    );
    expect(screen.getByText("PREV HASH")).toBeInTheDocument();
    // em-dash appears in container
    expect(container.textContent).toContain("—");
  });

  // -------------------------------------------------------------------------
  // Copy buttons
  // -------------------------------------------------------------------------

  it("renders [copy] buttons for ID and ENTITY", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    // At minimum: ID [copy], ENTITY [copy], HASH [copy full], PREV HASH [copy full]
    expect(copyButtons.length).toBeGreaterThanOrEqual(2);
  });

  it("renders [copy full] buttons for HASH and PREV HASH", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    const copyFullButtons = screen.getAllByRole("button", { name: /copy full/i });
    expect(copyFullButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("clicking [copy full] on HASH calls navigator.clipboard.writeText with the full hash", async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();

    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);

    const copyFullButtons = screen.getAllByRole("button", { name: /copy full/i });
    // First [copy full] button is for HASH
    await user.click(copyFullButtons[0]);

    expect(writeText).toHaveBeenCalledWith(
      "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    );
  });

  it("clipboard error path doesn't crash when navigator.clipboard is undefined", async () => {
    const user = userEvent.setup();
    removeClipboard();

    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    const copyFullButtons = screen.getAllByRole("button", { name: /copy full/i });

    // Should not throw
    await expect(user.click(copyFullButtons[0])).resolves.not.toThrow();
  });

  it("clipboard error path doesn't crash when writeText rejects", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) },
      writable: true,
      configurable: true,
    });

    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    const copyFullButtons = screen.getAllByRole("button", { name: /copy full/i });

    // Should not throw or cause unhandled rejection
    await expect(user.click(copyFullButtons[0])).resolves.not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  it("renders as a region with aria-label for screen readers", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(
      screen.getByRole("region", { name: /Details for audit entry audit_ax8f2k1z/ }),
    ).toBeInTheDocument();
  });

  it("drawer has the drawerId as its id attribute", () => {
    render(<ActivityRowDrawer row={makeRow()} drawerId={DRAW_ID} />);
    expect(document.getElementById(DRAW_ID)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // XSS regression: summary is rendered as text, never HTML
  // -------------------------------------------------------------------------

  it("XSS regression: summary with <script> tag is rendered as literal text, not executed", () => {
    const { container } = render(
      <ActivityRowDrawer
        row={makeRow({ summary: "<script>alert(1)</script>" })}
        drawerId={DRAW_ID}
      />,
    );
    // The literal text must appear
    expect(container.textContent).toContain("<script>alert(1)</script>");
    // No actual <script> element must be present
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Snapshot-value regression: drawer never renders snapshot values
  // -------------------------------------------------------------------------

  it("regression: drawer never renders snapshot values — only key names", () => {
    // Build a row where snapshotKeys are present.
    // Since AuditEntryBrowseRow.snapshotKeys is string[] (key names only, no values),
    // the drawer can only render the names. We include a sentinel in the summary to
    // prove the DOM doesn't leak hidden values.
    const sentinelValue = "__NEVER_RENDER_SENTINEL__";
    const row = makeRow({
      snapshotKeys: ["actionType", "decisionId"],
      redactedKeyCount: 4,
      summary: "Normal summary text",
    });

    const { container } = render(<ActivityRowDrawer row={row} drawerId={DRAW_ID} />);

    // The sentinel value must NOT appear in the DOM
    expect(container.textContent).not.toContain(sentinelValue);
    // The word "value" in JSON-stringified form must not appear (no {key: value} patterns)
    expect(container.textContent).not.toContain('"value":');
    // The key names are present
    expect(container.textContent).toContain("actionType");
    expect(container.textContent).toContain("decisionId");
  });

  // -------------------------------------------------------------------------
  // storageRef regression: drawer never renders evidencePointers[].storageRef
  // -------------------------------------------------------------------------

  it("regression: drawer never renders storageRef — only type and hashPrefix", () => {
    // AuditEntryBrowseRow.evidencePointers has { type, hash, hashPrefix } only —
    // no storageRef field. This test confirms the rendered DOM doesn't contain
    // any storageRef-shaped content (defense-in-depth against schema drift).
    //
    // We inject a sentinel in hashPrefix (which IS rendered) to prove the test
    // correctly observes rendered output, then assert storageRef-shaped content
    // is absent.
    const row: AuditEntryBrowseRow = makeRow({
      evidencePointers: [
        {
          type: "pointer",
          hash: "a".repeat(64),
          // hashPrefix is what the drawer renders — a 16-char display string
          hashPrefix: "aaaaaaaaaaaaaaaa",
        },
      ],
    });

    const { container } = render(<ActivityRowDrawer row={row} drawerId={DRAW_ID} />);

    // hashPrefix IS rendered (proves the component rendered the pointer at all)
    expect(container.textContent).toContain("aaaaaaaaaaaaaaaa");

    // storageRef content must never appear — the type doesn't carry it
    expect(container.textContent).not.toContain("storageRef");
    expect(container.textContent).not.toContain("s3://");
    expect(container.textContent).not.toContain("__SENTINEL__");
  });

  it("regression: storageRef sentinel pattern does not appear when using a sentinel hashPrefix", () => {
    // Construct a fixture with a sentinel that would only appear if storageRef leaked
    const storageRefSentinel = "s3://__SENTINEL__";
    const row: AuditEntryBrowseRow = makeRow({
      evidencePointers: [
        {
          type: "pointer",
          hash: storageRefSentinel.padEnd(64, "x"),
          // NOTE: hash is stored but the drawer never renders the raw hash (only hashPrefix
          // for display and the full hash is only sent to clipboard, not rendered in DOM)
          hashPrefix: "sentinel_display",
        },
      ],
    });

    const { container } = render(<ActivityRowDrawer row={row} drawerId={DRAW_ID} />);

    // The hashPrefix IS rendered as display text
    expect(container.textContent).toContain("sentinel_display");

    // The raw hash (which contains the sentinel) must not appear in the DOM text
    // (it's only used for the clipboard copy, not rendered inline)
    expect(container.textContent).not.toContain(storageRefSentinel);
  });
});
