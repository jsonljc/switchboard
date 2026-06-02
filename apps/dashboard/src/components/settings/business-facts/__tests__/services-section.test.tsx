import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useForm, FormProvider } from "react-hook-form";
import { emptyBusinessFacts, type BusinessFactsForm } from "../scaffold";
import { ServicesSection } from "../services-section";

function Host() {
  const methods = useForm<BusinessFactsForm>({ defaultValues: emptyBusinessFacts() });
  return (
    <FormProvider {...methods}>
      <ServicesSection control={methods.control} register={methods.register} />
    </FormProvider>
  );
}

describe("ServicesSection", () => {
  it("Add appends a row", () => {
    render(<Host />);
    expect(screen.getAllByText(/service \d/i)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /add service/i }));
    expect(screen.getAllByText(/service \d/i)).toHaveLength(2);
  });
});
