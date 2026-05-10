import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationsTable } from "../components/automations-table";
import { AUTOMATIONS_FIXTURE_PAGE } from "../fixtures";

const ALL_ROWS = AUTOMATIONS_FIXTURE_PAGE.rows;

describe("<AutomationsTable />", () => {
  it("renders all rows and the column headers in the resolved tz", () => {
    render(<AutomationsTable rows={ALL_ROWS} timezone="UTC" />);
    expect(screen.getByRole("columnheader", { name: /TYPE/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /SCHEDULE/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /CREATED · UTC/ })).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(ALL_ROWS.length);
  });

  it("chevron is a button with aria-expanded=false initially", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("clicking the chevron opens the drawer; clicking again closes it", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(ALL_ROWS[0]!.id)).toBeInTheDocument();
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("opening another row's drawer closes the first", () => {
    render(<AutomationsTable rows={ALL_ROWS.slice(0, 2)} timezone="UTC" />);
    const chevrons = screen.getAllByRole("button", { name: /Expand row/i });
    fireEvent.click(chevrons[0]!);
    expect(chevrons[0]!).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chevrons[1]!);
    expect(chevrons[0]!).toHaveAttribute("aria-expanded", "false");
    expect(chevrons[1]!).toHaveAttribute("aria-expanded", "true");
  });

  it("chevron is a real <button> with type=button, so native keyboard activation works", () => {
    // Real <button> elements dispatch click on Enter/Space natively. jsdom does
    // not synthesize the native click from fireEvent.keyDown, so we assert the
    // rendered element actually has the keyboard contract (button + type) and
    // exercise the onClick path via a real click.
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    expect(chevron.tagName).toBe("BUTTON");
    expect(chevron.getAttribute("type")).toBe("button");
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking the row body does not open the drawer", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const dataRow = screen.getAllByRole("row")[1]!;
    fireEvent.click(dataRow);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });
});
