import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaginationFooter } from "../pagination-footer.js";

describe("PaginationFooter", () => {
  it("renders the 'Showing N of …' info line with keyset chrome", () => {
    render(
      <PaginationFooter
        count={22}
        canGoPrev={false}
        canGoNext={true}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText("22")).toBeInTheDocument();
    expect(screen.getByText(/keyset cursor — total unknown by design/)).toBeInTheDocument();
    expect(screen.getByText(/limit/)).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("← Newer is disabled when canGoPrev=false; Older → is enabled when canGoNext=true", () => {
    render(
      <PaginationFooter
        count={22}
        canGoPrev={false}
        canGoNext={true}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Newer/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Older/ })).not.toBeDisabled();
  });

  it("Older → is disabled when canGoNext=false (end of list)", () => {
    render(
      <PaginationFooter
        count={3}
        canGoPrev={true}
        canGoNext={false}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Older/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Newer/ })).not.toBeDisabled();
  });

  it("clicking Newer / Older fires the right callback", async () => {
    const user = userEvent.setup();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <PaginationFooter
        count={22}
        canGoPrev={true}
        canGoNext={true}
        onPrev={onPrev}
        onNext={onNext}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Newer/ }));
    await user.click(screen.getByRole("button", { name: /Older/ }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when neither direction is navigable (single-page case)", () => {
    const { container } = render(
      <PaginationFooter
        count={3}
        canGoPrev={false}
        canGoNext={false}
        onPrev={() => {}}
        onNext={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
