import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { visibleText } from "./visible-text";

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { organizationId: "org-1", principalId: "p-1" },
    status: "authenticated",
  }),
}));
vi.mock("@/lib/route-availability", () => ({ isMercuryToolLive: () => false }));
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { ApprovalsPage } from "../approvals-page";

const DENYLIST = [
  /\bbinding\b/i,
  /\benvelope\b/i,
  /\bsha256\b/i,
  /\blifecycle\b/i,
  /\bdispatch(?:ing|ed)?\b/i,
  /\bidempoten/i,
  /\bexecutable work unit\b/i,
  /\bfrozen for\b/i,
  /\bcartridge\b/i,
];

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ApprovalsPage />
    </QueryClientProvider>,
  );
}

describe("Copy-language denylist", () => {
  it("idle queue + detail render contains no banned vocabulary", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/Refund SGD 4,820/)).toBeInTheDocument());
    const text = visibleText();
    for (const pattern of DENYLIST) {
      expect(text, `Denylist match: ${pattern}`).not.toMatch(pattern);
    }
  });
});
