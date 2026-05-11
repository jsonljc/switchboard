import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaginationFooter } from "../pagination-footer";

describe("PaginationFooter", () => {
  it("renders nothing when rowsLoaded is 0", () => {
    const { container } = render(
      <PaginationFooter
        rowsLoaded={0}
        hasMore={false}
        onLoadMore={() => {}}
        isFetchingMore={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders 'Showing N total' when there is no more data", () => {
    render(
      <PaginationFooter
        rowsLoaded={42}
        hasMore={false}
        onLoadMore={() => {}}
        isFetchingMore={false}
      />,
    );
    expect(screen.getByText("Showing 42 total")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more/i })).toBeNull();
  });

  it("renders 'Showing 1–N · more →' button when hasMore is true", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    render(
      <PaginationFooter
        rowsLoaded={50}
        hasMore={true}
        onLoadMore={onLoadMore}
        isFetchingMore={false}
      />,
    );
    expect(screen.getByText("Showing 1–50")).toBeInTheDocument();
    const moreButton = screen.getByRole("button", { name: /more/ });
    await user.click(moreButton);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("disables and relabels the button while fetching", () => {
    render(
      <PaginationFooter
        rowsLoaded={50}
        hasMore={true}
        onLoadMore={() => {}}
        isFetchingMore={true}
      />,
    );
    const button = screen.getByRole("button", { name: /Loading/ });
    expect(button).toBeDisabled();
  });
});
