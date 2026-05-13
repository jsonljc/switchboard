import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityRowDrawer } from "../components/activity-row-drawer.js";

const makeRow = (overrides: Partial<AuditEntryBrowseRow> = {}): AuditEntryBrowseRow => ({
  id: "audit_test_001",
  eventType: "action.approved",
  timestamp: "2026-05-10T06:23:11.420Z",
  actorType: "user",
  actorId: "user_kim_principal",
  entityType: "approval_envelope",
  entityId: "env_2f1a08c4",
  riskCategory: "critical",
  visibilityLevel: "org",
  summary: "Operator signed refund of SGD 4,820 to client #SG-44120",
  snapshotKeys: ["actionType", "approvalId", "decisionId", "envelopeId", "correlationId"],
  redactedKeyCount: 5,
  evidencePointers: [],
  entryHash: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  previousEntryHash: "0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
  envelopeId: null,
  traceId: null,
  ...overrides,
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

describe("ActivityRowDrawer — Timestamp section", () => {
  it("renders the full ISO date, time, and tz", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText("2026-05-10")).toBeInTheDocument();
    expect(screen.getByText("06:23:11.420")).toBeInTheDocument();
    expect(screen.getByText("+00:00")).toBeInTheDocument();
  });

  it("carries the local-tz prose note", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText(/stored as ISO-8601 UTC on the entry/i)).toBeInTheDocument();
  });
});

describe("ActivityRowDrawer — Visibility · classification section", () => {
  it("renders visibility, risk, and eventType inline", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText("org")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("action.approved")).toBeInTheDocument();
  });

  it("carries the server-filtered visibility prose note", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText(/visibilityLevel is server-filtered/i)).toBeInTheDocument();
  });
});

describe("ActivityRowDrawer — Snapshot keys section", () => {
  it("renders one chip per snapshot key", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    for (const key of ["actionType", "approvalId", "decisionId", "envelopeId", "correlationId"]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  it("renders the +N redacted pill when redactedKeyCount > 0", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText(/\+5 redacted/i)).toBeInTheDocument();
  });

  it("renders 'no snapshot keys recorded' when snapshotKeys is empty", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ snapshotKeys: [], redactedKeyCount: 0 })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/no snapshot keys recorded/i)).toBeInTheDocument();
  });

  it("H3: snapshot VALUES are never rendered", () => {
    // The fixture intentionally carries a key name "envelopeId" but no value.
    // The drawer must render only the *name* "envelopeId" as a chip, never an id.
    const { container } = render(
      <ActivityRowDrawer
        row={makeRow({ snapshotKeys: ["envelopeId", "approvalId"], envelopeId: null })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    // The drawer should not contain any obviously-id-shaped text in the
    // snapshot section beyond the key names themselves.
    const snapshotSection = container.querySelector("[data-section='snapshot']");
    expect(snapshotSection).toBeInTheDocument();
    expect(snapshotSection?.textContent).not.toMatch(/env_/);
    expect(snapshotSection?.textContent).not.toMatch(/SGD/);
  });

  it("H2: storageRef is never rendered, even if injected into the row", () => {
    // AuditEntryBrowseRow doesn't carry storageRef, but defense-in-depth:
    // hand-craft a row that ALSO has a storageRef field on its evidence
    // pointers (extra TS-cast) and verify the drawer never renders it.
    const tainted = {
      ...makeRow(),
      evidencePointers: [
        {
          type: "pointer" as const,
          hash: "abc",
          hashPrefix: "abc",
          storageRef: "s3://buckets/super-secret/path",
        },
      ],
    } as unknown as AuditEntryBrowseRow;
    const { container } = render(
      <ActivityRowDrawer row={tainted} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(container.textContent).not.toContain("s3://");
    expect(container.textContent).not.toContain("super-secret");
  });
});
