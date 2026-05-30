import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { CreateTemplateDialog } from "../whatsapp-template-create";

const mutate = vi.fn();
vi.mock("@/hooks/use-whatsapp-template-create", () => ({
  useCreateWhatsAppTemplate: () => ({ mutate, isPending: false, isError: false, error: null }),
}));

function renderDialog() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CreateTemplateDialog />
    </QueryClientProvider>,
  );
}

describe("CreateTemplateDialog", () => {
  it("opens the dialog and shows a sample input when the body has a variable", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));
    const bodyField = await screen.findByLabelText(/body/i);
    fireEvent.change(bodyField, { target: { value: "Hi {{1}}" } });
    expect(await screen.findByLabelText(/sample for \{\{1\}\}/i)).toBeInTheDocument();
  });

  it("submits a valid template via the mutation", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));
    fireEvent.change(await screen.findByLabelText(/template name/i), {
      target: { value: "order_update" },
    });
    fireEvent.change(screen.getByLabelText(/^body/i), { target: { value: "Hello." } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({
      name: "order_update",
      body: { text: "Hello." },
    });
  });

  it("resets the form when closed via Cancel", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));
    const body = await screen.findByLabelText(/^body/i);
    fireEvent.change(body, { target: { value: "Draft text" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: /create template/i }));
    expect(((await screen.findByLabelText(/^body/i)) as HTMLTextAreaElement).value).toBe("");
  });
});
