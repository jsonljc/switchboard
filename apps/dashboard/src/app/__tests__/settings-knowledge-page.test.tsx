import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const useSessionMock = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => useSessionMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import SettingsKnowledgePage from "../(auth)/settings/knowledge/page";

describe("SettingsKnowledgePage", () => {
  it("renders a loading skeleton while the session is loading", () => {
    useSessionMock.mockReturnValue({ status: "loading" });

    render(<SettingsKnowledgePage />);

    expect(screen.getByTestId("knowledge-skeleton")).toBeInTheDocument();
  });
});
