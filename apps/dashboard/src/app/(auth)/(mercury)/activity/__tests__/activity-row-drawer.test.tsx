import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEntryBrowseRow } from "@switchboard/schemas";
import { ActivityRowDrawer } from "../components/activity-row-drawer";

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

describe("ActivityRowDrawer — Evidence pointers section", () => {
  it("renders one evidence row per pointer with hash prefix highlighted", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({
          evidencePointers: [
            {
              type: "pointer",
              hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              hashPrefix: "abcdef0123456789",
            },
            {
              type: "inline",
              hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              hashPrefix: "0123456789abcdef",
            },
          ],
        })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText("pointer")).toBeInTheDocument();
    expect(screen.getByText("inline")).toBeInTheDocument();
    expect(screen.getAllByText(/copy hash/i)).toHaveLength(2);
  });

  it("renders the absence note for storageRef", () => {
    render(
      <ActivityRowDrawer row={makeRow()} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />,
    );
    expect(screen.getByText(/storageRef.*intentionally absent/i)).toBeInTheDocument();
  });

  it("renders 'no evidence pointers attached' when list is empty", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ evidencePointers: [] })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/no evidence pointers attached/i)).toBeInTheDocument();
  });

  it("H4: copy hash button does not throw when clipboard is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    render(
      <ActivityRowDrawer
        row={makeRow({
          evidencePointers: [
            {
              type: "pointer",
              hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              hashPrefix: "abcdef0123456789",
            },
          ],
        })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    const btn = screen.getByRole("button", { name: /copy hash/i });
    await expect(user.click(btn)).resolves.not.toThrow();
  });
});

describe("ActivityRowDrawer — Hash chain section", () => {
  it("renders entryHash and previousEntryHash in full", () => {
    const row = makeRow();
    render(<ActivityRowDrawer row={row} allRows={[]} onScrollToRow={() => {}} orgTimezone="UTC" />);
    expect(screen.getByText(row.entryHash)).toBeInTheDocument();
    expect(screen.getByText(row.previousEntryHash as string)).toBeInTheDocument();
  });

  it("renders genesis tag when previousEntryHash is null", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ previousEntryHash: null })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/genesis \(no predecessor\)/i)).toBeInTheDocument();
  });

  it("renders 'view previous ↓' when predecessor row is on the page, off-page tag otherwise", () => {
    const target = makeRow({
      id: "audit_target",
      entryHash: "previoushash_target",
    });
    const child = makeRow({
      id: "audit_child",
      previousEntryHash: "previoushash_target",
    });
    const { rerender } = render(
      <ActivityRowDrawer
        row={child}
        allRows={[target, child]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByRole("button", { name: /view previous/i })).toBeInTheDocument();

    rerender(
      <ActivityRowDrawer
        row={child}
        allRows={[child]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.queryByRole("button", { name: /view previous/i })).not.toBeInTheDocument();
    expect(screen.getByText(/off-page/i)).toBeInTheDocument();
  });

  it("clicking 'view previous ↓' calls onScrollToRow with the predecessor's id", async () => {
    const user = userEvent.setup();
    const onScrollToRow = vi.fn();
    const target = makeRow({ id: "audit_target", entryHash: "previoushash_target" });
    const child = makeRow({ id: "audit_child", previousEntryHash: "previoushash_target" });
    render(
      <ActivityRowDrawer
        row={child}
        allRows={[target, child]}
        onScrollToRow={onScrollToRow}
        orgTimezone="UTC"
      />,
    );
    await user.click(screen.getByRole("button", { name: /view previous/i }));
    expect(onScrollToRow).toHaveBeenCalledWith("audit_target");
  });
});

describe("ActivityRowDrawer — References section", () => {
  it("renders envelope id with copy + open link when set", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ envelopeId: "env_xyz_123" })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText("env_xyz_123")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open ↗/i });
    expect(link).toHaveAttribute("href", "/approvals/env_xyz_123");
  });

  it("renders 'no approval envelope' italic when envelopeId is null", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ envelopeId: null })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    expect(screen.getByText(/no approval envelope/i)).toBeInTheDocument();
  });

  it("renders trace id with /traces/ link when set", () => {
    render(
      <ActivityRowDrawer
        row={makeRow({ traceId: "trace_abc_456" })}
        allRows={[]}
        onScrollToRow={() => {}}
        orgTimezone="UTC"
      />,
    );
    const link = screen.getByRole("link", { name: /open ↗/i });
    expect(link).toHaveAttribute("href", "/traces/trace_abc_456");
  });
});
