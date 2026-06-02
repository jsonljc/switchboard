import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { emptyBusinessFacts, type BusinessFactsForm } from "../scaffold";
import { HoursSection } from "../hours-section";

function Host() {
  const methods = useForm<BusinessFactsForm>({ defaultValues: emptyBusinessFacts() });
  return (
    <FormProvider {...methods}>
      <HoursSection />
    </FormProvider>
  );
}

describe("HoursSection", () => {
  it("renders a row per weekday and disables times when closed", () => {
    render(<Host />);
    // Sunday is closed by default in the scaffold → its time inputs are disabled
    const sundayOpen = screen.getByLabelText(/sunday open/i) as HTMLInputElement;
    expect(sundayOpen).toBeDisabled();
    const mondayOpen = screen.getByLabelText(/monday open/i) as HTMLInputElement;
    expect(mondayOpen).not.toBeDisabled();
  });
});
