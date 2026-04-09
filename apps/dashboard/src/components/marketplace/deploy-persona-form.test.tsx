import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeployPersonaForm } from "./deploy-persona-form";

describe("DeployPersonaForm", () => {
  it("renders all form sections", () => {
    render(<DeployPersonaForm onSubmit={vi.fn()} isSubmitting={false} />);
    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what you sell/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/value proposition/i)).toBeInTheDocument();
    expect(screen.getByText(/tone/i)).toBeInTheDocument();
  });

  it("disables submit when required fields are empty", () => {
    render(<DeployPersonaForm onSubmit={vi.fn()} isSubmitting={false} />);
    const submit = screen.getByRole("button", { name: /deploy/i });
    expect(submit).toBeDisabled();
  });

  it("calls onSubmit with persona data when form is valid", () => {
    const onSubmit = vi.fn();
    render(<DeployPersonaForm onSubmit={onSubmit} isSubmitting={false} />);

    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/business type/i), { target: { value: "SaaS" } });
    fireEvent.change(screen.getByLabelText(/what you sell/i), { target: { value: "CRM" } });
    fireEvent.change(screen.getByLabelText(/value proposition/i), {
      target: { value: "Better sales" },
    });

    const submit = screen.getByRole("button", { name: /deploy/i });
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        businessName: "Acme",
        businessType: "SaaS",
        productService: "CRM",
        valueProposition: "Better sales",
        tone: "professional",
      }),
    );
  });
});
