import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContactBrowseRow } from "@switchboard/schemas";
import { ContactsTable } from "../contacts-table";

const NOW = new Date("2026-05-09T12:00:00.000Z");

const sampleRows: ContactBrowseRow[] = [
  {
    id: "c-1",
    displayName: "Lisa K.",
    stage: "active",
    primaryChannel: "whatsapp",
    source: null,
    lastActivityAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
    firstContactAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString(),
    opportunityCount: 2,
    detailHref: "/contacts/c-1",
  },
  {
    id: "c-2",
    displayName: "Maya T.",
    stage: "customer",
    primaryChannel: "telegram",
    source: null,
    lastActivityAt: new Date(NOW.getTime() - 36 * 3_600_000).toISOString(),
    firstContactAt: new Date(NOW.getTime() - 34 * 86_400_000).toISOString(),
    opportunityCount: 0,
    detailHref: "/contacts/c-2",
  },
];

describe("ContactsTable", () => {
  it("renders the spec column set in the documented order", () => {
    render(
      <ContactsTable
        rows={sampleRows}
        detailEnabled={false}
        sort="lastActivityAt"
        direction="desc"
        onSortChange={() => {}}
        now={NOW}
      />,
    );
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers.slice(0, 6)).toEqual([
      "Name",
      "Stage",
      "Channel",
      "Opps",
      expect.stringMatching(/Last activity/),
      expect.stringMatching(/First contact/),
    ]);
  });

  it("only marks Last activity and First contact as sortable", () => {
    render(
      <ContactsTable
        rows={sampleRows}
        detailEnabled={false}
        sort="lastActivityAt"
        direction="desc"
        onSortChange={() => {}}
        now={NOW}
      />,
    );
    const last = screen.getByRole("columnheader", { name: /Last activity/ });
    const first = screen.getByRole("columnheader", { name: /First contact/ });
    expect(last).toHaveAttribute("aria-sort", "descending");
    expect(first).toHaveAttribute("aria-sort", "none");
    // Name / Stage / Channel / Opps don't carry an aria-sort.
    expect(screen.getByRole("columnheader", { name: "Name" })).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("columnheader", { name: "Stage" })).not.toHaveAttribute("aria-sort");
  });

  it("emits sort changes when a sortable header is clicked", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    render(
      <ContactsTable
        rows={sampleRows}
        detailEnabled={false}
        sort="lastActivityAt"
        direction="desc"
        onSortChange={onSortChange}
        now={NOW}
      />,
    );
    await user.click(screen.getByRole("columnheader", { name: /First contact/ }));
    expect(onSortChange).toHaveBeenCalledWith("firstContactAt");
  });

  it("marks the name cell aria-disabled with the redundancy tooltip when detailEnabled is false (D1)", () => {
    render(
      <ContactsTable
        rows={sampleRows}
        detailEnabled={false}
        sort="lastActivityAt"
        direction="desc"
        onSortChange={() => {}}
        now={NOW}
      />,
    );
    // aria-disabled lives on the element that would have been the Link, not on
    // the <tr> (non-effective there per ARIA). The persistent above-table
    // notice is the primary signal; this is the redundancy.
    for (const row of sampleRows) {
      const cell = screen.getByText(row.displayName);
      expect(cell).toHaveAttribute("aria-disabled", "true");
      expect(cell).toHaveAttribute("title", "Detail coming next");
    }
    // No <Link> in the disabled state.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders rows as enabled with link cell when detailEnabled is true (D1.5+)", () => {
    render(
      <ContactsTable
        rows={sampleRows}
        detailEnabled={true}
        sort="lastActivityAt"
        direction="desc"
        onSortChange={() => {}}
        now={NOW}
      />,
    );
    expect(screen.queryByTitle("Detail coming next")).toBeNull();
    const link = screen.getByRole("link", { name: /Open Lisa K\./ });
    expect(link).toHaveAttribute("href", "/contacts/c-1");
  });

  it("muted dash for opportunityCount=0", () => {
    render(
      <ContactsTable
        rows={sampleRows}
        detailEnabled={false}
        sort="lastActivityAt"
        direction="desc"
        onSortChange={() => {}}
        now={NOW}
      />,
    );
    const mayaRow = screen.getByText("Maya T.").closest("tr") as HTMLTableRowElement;
    expect(within(mayaRow).getByText("—")).toBeInTheDocument();
    const lisaRow = screen.getByText("Lisa K.").closest("tr") as HTMLTableRowElement;
    expect(within(lisaRow).getByText("2")).toBeInTheDocument();
  });
});
