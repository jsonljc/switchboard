import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import type { ReactNode } from "react";

const useKnowledgeDocuments = vi.fn();
vi.mock("@/hooks/use-knowledge", () => ({
  useKnowledgeDocuments: () => useKnowledgeDocuments(),
  useUploadKnowledge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDocument: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { UploadPanel } from "../upload-panel";

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: qc }, node));
}

describe("UploadPanel - loading state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the shared Skeleton (not plain text) while loading", () => {
    useKnowledgeDocuments.mockReturnValue({ data: undefined, isLoading: true });
    wrap(<UploadPanel />);

    // The shared Skeleton is aria-hidden="true" (decorative); no plain-text fallback.
    expect(screen.queryByText("Loading documents...")).not.toBeInTheDocument();
    // Skeleton elements are aria-hidden so we check via data-testid or class; use
    // the data-testid we add on the loading container.
    expect(screen.getByTestId("upload-panel-loading")).toBeInTheDocument();
  });
});

describe("UploadPanel - error state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders role=alert (not role=status) when the hook is in an error state", () => {
    const refetch = vi.fn();
    useKnowledgeDocuments.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    wrap(<UploadPanel />);

    // Must show an alert, not the empty-state status panel.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    // The "No documents yet" empty-state must NOT appear in error state.
    expect(screen.queryByText(/no documents yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("calls refetch when the retry button is clicked", () => {
    const refetch = vi.fn();
    useKnowledgeDocuments.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    wrap(<UploadPanel />);

    const retryBtn = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe("UploadPanel - empty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders StatePanel with role=status when there are no documents", () => {
    useKnowledgeDocuments.mockReturnValue({ data: { documents: [] }, isLoading: false });
    wrap(<UploadPanel />);

    // StatePanel should render a region with role=status.
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Calm heading text.
    expect(screen.getByRole("heading", { name: /no documents yet/i })).toBeInTheDocument();
    // Old bare-text fallback must not appear.
    expect(screen.queryByText("No documents uploaded yet")).not.toBeInTheDocument();
  });

  it("does not render StatePanel when documents exist", () => {
    useKnowledgeDocuments.mockReturnValue({
      data: {
        documents: [
          {
            documentId: "doc-1",
            fileName: "guide.txt",
            chunkCount: 3,
            sourceType: "upload",
            uploadedAt: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
    });
    wrap(<UploadPanel />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("guide.txt")).toBeInTheDocument();
  });
});
