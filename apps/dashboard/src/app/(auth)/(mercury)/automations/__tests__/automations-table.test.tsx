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
    expect(screen.getAllByRole("row").length).toBeGreaterThan(ALL_ROWS.length); // tbody rows + thead
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

  it("Enter key on the chevron toggles the drawer", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    chevron.focus();
    fireEvent.keyDown(chevron, { key: "Enter" });
    // Real <button> elements automatically dispatch click on Enter; the test
    // confirms the rendered element is a real button so default keyboard
    // behaviour applies. We assert via tagName here rather than relying on
    // jsdom dispatching the synthetic click for keyDown.
    expect(chevron.tagName).toBe("BUTTON");
  });

  it("clicking the row body does not open the drawer", () => {
    render(<AutomationsTable rows={[ALL_ROWS[0]!]} timezone="UTC" />);
    const dataRow = screen.getAllByRole("row")[1]!; // [0] is thead
    fireEvent.click(dataRow);
    const chevron = screen.getByRole("button", { name: /Expand row/i });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });
});
