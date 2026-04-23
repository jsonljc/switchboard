import { describe, expect, it, vi } from "vitest";

vi.mock("@/providers/auth-provider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/layout/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/error-boundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/operator-chat/operator-chat-widget", () => ({
  OperatorChatWidget: () => null,
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));

vi.mock("@/lib/session", () => ({
  getServerSession: vi.fn(),
}));

import AuthLayout, { dynamic } from "../(auth)/layout";

describe("AuthLayout", () => {
  it("exports force-dynamic so authenticated pages are not prerendered", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(AuthLayout).toBeTypeOf("function");
  });
});
