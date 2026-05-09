import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ContactsListResponse } from "@switchboard/schemas";

const mockReplace = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => useSearchParamsMock(),
}));

const mockUseContactsList = vi.fn();
vi.mock("../hooks/use-contacts-list", () => ({
  useContactsList: (...args: unknown[]) => mockUseContactsList(...args),
}));

import { ContactsPage } from "../contacts-page";
import { CONTACTS_FIXTURE_PAGE } from "../fixtures";

function setSearch(qs: string) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(qs));
}

function hookResult(
  partial: Partial<{
    pages: ContactsListResponse[];
    isLoading: boolean;
    isError: boolean;
    fetchNextPage: () => Promise<unknown>;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    refetch: () => Promise<unknown>;
  }>,
): unknown {
  return {
    data: partial.pages ? { pages: partial.pages, pageParams: [undefined] } : undefined,
    isLoading: partial.isLoading ?? false,
    isError: partial.isError ?? false,
    isSuccess: !partial.isLoading && !partial.isError,
    refetch: partial.refetch ?? vi.fn().mockResolvedValue(undefined),
    fetchNextPage: partial.fetchNextPage ?? vi.fn().mockResolvedValue(undefined),
    hasNextPage: partial.hasNextPage ?? false,
    isFetchingNextPage: partial.isFetchingNextPage ?? false,
    error: null,
  };
}

describe("ContactsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearch("");
  });

  it("renders the loading skeleton on first fetch", () => {
    mockUseContactsList.mockReturnValue(hookResult({ isLoading: true }));
    render(<ContactsPage />);
    expect(screen.getByRole("status", { name: "Loading contacts" })).toBeInTheDocument();
  });

  it("renders the zero-state when there are no rows and no filters", () => {
    mockUseContactsList.mockReturnValue(
      hookResult({ pages: [{ rows: [], nextCursor: null, hasMore: false }] }),
    );
    render(<ContactsPage />);
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  });

  it("renders the filtered-empty state when filters are active and rows are empty", async () => {
    setSearch("stage=customer&q=lisa");
    mockUseContactsList.mockReturnValue(
      hookResult({ pages: [{ rows: [], nextCursor: null, hasMore: false }] }),
    );
    render(<ContactsPage />);

    expect(screen.getByText(/No matches/)).toBeInTheDocument();
    const clear = screen.getByRole("button", { name: /Clear/ });
    await userEvent.setup().click(clear);
    expect(mockReplace).toHaveBeenCalledWith("/contacts", { scroll: false });
  });

  it("renders the error state and wires Try again to refetch", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseContactsList.mockReturnValue(hookResult({ isError: true, refetch }));
    render(<ContactsPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the populated table and the browse-only notice while ROUTE_AVAILABILITY.contact === false", () => {
    mockUseContactsList.mockReturnValue(hookResult({ pages: [CONTACTS_FIXTURE_PAGE] }));
    render(<ContactsPage />);
    expect(screen.getByText(/Browse-only for now/)).toBeInTheDocument();
    expect(screen.getByText("Lisa K.")).toBeInTheDocument();
    expect(screen.getByText("Maya T.")).toBeInTheDocument();
    expect(screen.getByText("Priya S.")).toBeInTheDocument();
  });

  it("clicking a chip replaces the URL with the new stage param", async () => {
    mockUseContactsList.mockReturnValue(hookResult({ pages: [CONTACTS_FIXTURE_PAGE] }));
    render(<ContactsPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Customer" }));
    expect(mockReplace).toHaveBeenCalledWith("/contacts?stage=customer", { scroll: false });
  });

  it("clicking a sortable header toggles direction when sorting on the same column", async () => {
    setSearch("sort=lastActivityAt&direction=desc");
    mockUseContactsList.mockReturnValue(hookResult({ pages: [CONTACTS_FIXTURE_PAGE] }));
    render(<ContactsPage />);
    await userEvent.setup().click(screen.getByRole("columnheader", { name: /Last activity/ }));
    expect(mockReplace).toHaveBeenCalledWith("/contacts?sort=lastActivityAt&direction=asc", {
      scroll: false,
    });
  });

  it("clicking a sortable header on a new column resets direction to desc", async () => {
    mockUseContactsList.mockReturnValue(hookResult({ pages: [CONTACTS_FIXTURE_PAGE] }));
    render(<ContactsPage />);
    await userEvent.setup().click(screen.getByRole("columnheader", { name: /First contact/ }));
    expect(mockReplace).toHaveBeenCalledWith("/contacts?sort=firstContactAt&direction=desc", {
      scroll: false,
    });
  });

  it("threads stage and search from URL into the hook query", () => {
    setSearch("stage=active&q=lisa");
    mockUseContactsList.mockReturnValue(hookResult({ pages: [CONTACTS_FIXTURE_PAGE] }));
    render(<ContactsPage />);
    expect(mockUseContactsList).toHaveBeenLastCalledWith({
      stage: "active",
      search: "lisa",
      sort: "lastActivityAt",
      direction: "desc",
    });
  });

  it("ignores invalid stage values in the URL", () => {
    setSearch("stage=banana");
    mockUseContactsList.mockReturnValue(hookResult({ pages: [CONTACTS_FIXTURE_PAGE] }));
    render(<ContactsPage />);
    expect(mockUseContactsList).toHaveBeenLastCalledWith({
      stage: undefined,
      search: undefined,
      sort: "lastActivityAt",
      direction: "desc",
    });
  });

  it("renders the more button and calls fetchNextPage when hasMore", async () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    mockUseContactsList.mockReturnValue(
      hookResult({
        pages: [{ rows: CONTACTS_FIXTURE_PAGE.rows, nextCursor: "abc", hasMore: true }],
        hasNextPage: true,
        fetchNextPage,
      }),
    );
    render(<ContactsPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /more/ }));
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
