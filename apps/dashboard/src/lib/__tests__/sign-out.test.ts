import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next-auth/react before importing the wrapper. `vi.hoisted` lets the
// mock factory reach a shared spy that the test asserts against.
const { nextAuthSignOutSpy, callOrder } = vi.hoisted(() => ({
  nextAuthSignOutSpy: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock("next-auth/react", () => ({
  signOut: nextAuthSignOutSpy,
}));

import { signOut } from "../sign-out";

describe("signOut wrapper", () => {
  beforeEach(() => {
    nextAuthSignOutSpy.mockReset();
    callOrder.length = 0;
  });

  it("clears the React Query cache before delegating to NextAuth signOut", async () => {
    // Make signOut asynchronous so we can confirm clear() runs first
    // (i.e. not relying on microtask ordering coincidence).
    let resolveNextAuth: (() => void) | undefined;
    nextAuthSignOutSpy.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveNextAuth = () => {
            callOrder.push("nextAuthSignOut");
            resolve();
          };
        }),
    );

    const clear = vi.fn(() => {
      callOrder.push("clear");
    });
    const queryClient = { clear } as unknown as import("@tanstack/react-query").QueryClient;

    const pending = signOut(queryClient);

    // clear() runs synchronously before the awaited NextAuth call resolves.
    expect(callOrder).toEqual(["clear"]);

    resolveNextAuth!();
    await pending;

    expect(clear).toHaveBeenCalledTimes(1);
    expect(nextAuthSignOutSpy).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["clear", "nextAuthSignOut"]);
  });
});
