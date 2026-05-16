import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntitySelector } from "../entity-selector";

const TYPES = ["agent", "calendar_event", "connection", "policy"];

describe("EntitySelector", () => {
  it("renders type select populated from the provided types prop, sorted", () => {
    render(
      <EntitySelector
        entityType={null}
        entityId={null}
        types={["policy", "agent", "calendar_event"]}
        onChange={() => {}}
      />,
    );
    const select = screen.getByLabelText(/entity type/i) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["", "agent", "calendar_event", "policy"]);
  });

  it("renders the entityId text input", () => {
    render(<EntitySelector entityType={null} entityId={null} types={TYPES} onChange={() => {}} />);
    expect(screen.getByLabelText(/entity id/i)).toBeInTheDocument();
  });

  it("selecting a type fires onChange with the new type and preserves entityId", async () => {
    const onChange = vi.fn();
    render(<EntitySelector entityType={null} entityId="abc" types={TYPES} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByLabelText(/entity type/i), "policy");
    expect(onChange).toHaveBeenCalledWith({ entityType: "policy", entityId: "abc" });
  });

  it("typing into entityId fires onChange and preserves entityType", async () => {
    const onChange = vi.fn();
    render(
      <EntitySelector entityType="policy" entityId={null} types={TYPES} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/entity id/i);
    await userEvent.setup().type(input, "x");
    expect(onChange).toHaveBeenLastCalledWith({ entityType: "policy", entityId: "x" });
  });

  it("clearing entityId fires onChange with entityId: null", async () => {
    const onChange = vi.fn();
    render(<EntitySelector entityType={null} entityId="x" types={TYPES} onChange={onChange} />);
    const input = screen.getByLabelText(/entity id/i);
    await userEvent.setup().clear(input);
    expect(onChange).toHaveBeenCalledWith({ entityType: null, entityId: null });
  });
});
