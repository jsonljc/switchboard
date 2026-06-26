import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GovernanceMarket } from "../governance-market";

// Radix Select does not drive cleanly in jsdom (no pointer-capture stubs); mock it to a
// flat list of role="option" buttons that fire onValueChange — mirrors channel-management.test.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: ReactNode;
    onValueChange: (v: string) => void;
    value?: string;
  }) => {
    const ctx = { onValueChange };
    return (
      <div data-mock-select>
        <SelectCtx.Provider value={ctx}>{children}</SelectCtx.Provider>
      </div>
    );
  },
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
    const ctx = useSelectCtx();
    return (
      <button
        type="button"
        role="option"
        aria-selected={false}
        onClick={() => ctx.onValueChange(value)}
      >
        {children}
      </button>
    );
  },
}));

// Minimal context to thread onValueChange from the mocked Select to its SelectItems.
import { createContext, useContext } from "react";
const SelectCtx = createContext<{ onValueChange: (v: string) => void }>({
  onValueChange: () => {},
});
const useSelectCtx = () => useContext(SelectCtx);

describe("GovernanceMarket", () => {
  it("prefills the current market and saves the (changed) selection after confirm", () => {
    const onSave = vi.fn();
    render(
      <GovernanceMarket
        current={{ jurisdiction: "SG", clinicType: "medical" }}
        pending={false}
        onSave={onSave}
      />,
    );

    // change jurisdiction -> MY and clinicType -> nonMedical
    fireEvent.click(screen.getByRole("option", { name: /Malaysia/i }));
    fireEvent.click(screen.getByRole("option", { name: /Non-medical/i }));

    // open confirm + confirm
    fireEvent.click(screen.getByRole("button", { name: /save market/i }));
    fireEvent.click(screen.getByTestId("confirm-market"));

    expect(onSave).toHaveBeenCalledWith("MY", "nonMedical");
  });

  it("defaults the selection to SG/medical when the current market is unset (null)", () => {
    const onSave = vi.fn();
    render(
      <GovernanceMarket
        current={{ jurisdiction: null, clinicType: null }}
        pending={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /save market/i }));
    fireEvent.click(screen.getByTestId("confirm-market"));
    expect(onSave).toHaveBeenCalledWith("SG", "medical");
  });

  it("disables Save while a write is pending", () => {
    render(
      <GovernanceMarket
        current={{ jurisdiction: "MY", clinicType: "medical" }}
        pending
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /save market/i })).toBeDisabled();
  });
});
