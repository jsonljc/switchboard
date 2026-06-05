import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { emptyBusinessFacts, type BusinessFactsForm } from "../scaffold";
import { LocationsSection } from "../locations-section";

function Host() {
  const methods = useForm<BusinessFactsForm>({ defaultValues: emptyBusinessFacts() });
  return (
    <FormProvider {...methods}>
      <LocationsSection />
    </FormProvider>
  );
}

describe("LocationsSection", () => {
  it("Add appends a row", () => {
    render(<Host />);
    expect(screen.getAllByText(/location \d/i)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /add location/i }));
    expect(screen.getAllByText(/location \d/i)).toHaveLength(2);
  });
});
