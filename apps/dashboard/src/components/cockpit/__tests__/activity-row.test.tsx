import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityRow } from "../activity-row";
import type { ActivityRow as ActivityRowType } from "../types";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const baseRow: ActivityRowType = {
  id: "a1",
  time: "11:58",
  kind: "booked",
  head: "Maya Lin confirmed Pilates intro Sat 2pm",
  body: "Calendar held. Wants studio tour first",
  who: "Maya Lin",
  contactId: "c1",
  preview: [
    { from: "contact", text: "Can I tour first?" },
    { from: "alex", text: "Sat at 2pm works." },
  ],
  replyable: true,
};

function setup(row: Partial<ActivityRowType>, open = false) {
  const toggle = vi.fn();
  render(
    <ul>
      <ActivityRow item={{ ...baseRow, ...row }} open={open} toggle={toggle} />
    </ul>,
  );
  return { toggle };
}

describe("<ActivityRow>", () => {
  it("renders head when collapsed", () => {
    setup({}, false);
    expect(screen.getByText(/Maya Lin confirmed/)).toBeInTheDocument();
    expect(screen.queryByText("Wants studio tour first")).not.toBeInTheDocument();
  });

  it("shows expand chevron when replyable", () => {
    setup({}, false);
    expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
  });

  it("hides expand chevron when replyable=false", () => {
    setup({ replyable: false, preview: undefined }, false);
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
  });

  it("hides expand chevron when replyable=true but no preview/body/contactId", () => {
    // Defensive: a future translator that mis-sets replyable=true on a
    // contentless row should NOT yield an expandable chevron with nothing
    // to show. This is the Riley-safety invariant from the slice brief.
    setup(
      {
        replyable: true,
        preview: undefined,
        body: undefined,
        contactId: undefined,
        who: undefined,
      },
      false,
    );
    expect(screen.queryByRole("button", { name: /expand/i })).not.toBeInTheDocument();
  });

  it("shows expand chevron when replyable=true and only body is present", () => {
    setup({ replyable: true, preview: undefined, body: "Calendar held." }, false);
    expect(screen.getByRole("button", { name: /expand/i })).toBeInTheDocument();
  });

  it("clicking chevron toggles open", async () => {
    const user = userEvent.setup();
    const { toggle } = setup({}, false);
    await user.click(screen.getByRole("button", { name: /expand/i }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("renders body + preview + 'Tell Alex about' when open", () => {
    setup({}, true);
    expect(screen.getByText(/Calendar held/)).toBeInTheDocument();
    expect(screen.getByText("Can I tour first?")).toBeInTheDocument();
    expect(screen.getByText(/Tell Alex about Maya/i)).toBeInTheDocument();
  });

  it("'Tell Alex about {firstName}' routes to /contacts/[id]?note=open", async () => {
    const user = userEvent.setup();
    setup({}, true);
    await user.click(screen.getByText(/Tell Alex about Maya/i));
    expect(pushMock).toHaveBeenCalledWith("/contacts/c1?note=open");
  });

  it("hides 'Tell Alex about' when contactId missing", () => {
    setup({ contactId: undefined }, true);
    expect(screen.queryByText(/Tell Alex about/i)).not.toBeInTheDocument();
  });

  it("renders tag span when tag present", () => {
    setup({ tag: "+12" }, false);
    expect(screen.getByText("+12")).toBeInTheDocument();
  });
});
