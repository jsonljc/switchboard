import { describe, it, expect, vi } from "vitest";
import { isOperatorMessage, delegateOperatorCommand } from "../operator-handler.js";
import type { EventLoopDelegateConfig } from "../lead-handler.js";

describe("operator-handler", () => {
  describe("isOperatorMessage", () => {
    it("returns true when principal has operator role", () => {
      const roles = ["requester", "operator"];
      expect(isOperatorMessage(roles)).toBe(true);
    });

    it("returns false when principal lacks operator role", () => {
      const roles = ["requester"];
      expect(isOperatorMessage(roles)).toBe(false);
    });

    it("returns false for empty roles", () => {
      expect(isOperatorMessage([])).toBe(false);
      expect(isOperatorMessage(undefined)).toBe(false);
    });
  });

  describe("delegateOperatorCommand", () => {
    it("sends command to API operator endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            commandId: "cmd-1",
            status: "completed",
            message: "Done — pipeline summary.",
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const config: EventLoopDelegateConfig = { apiUrl: "http://localhost:3000" };
      const sendReply = vi.fn();

      await delegateOperatorCommand(config, {
        rawInput: "show pipeline",
        channel: "telegram",
        operatorId: "op-1",
        organizationId: "org-1",
        sendReply,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/operator/command",
        expect.objectContaining({ method: "POST" }),
      );
      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("Done"));

      vi.unstubAllGlobals();
    });

    it("sends error reply on API failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: "Error" }),
      );

      const sendReply = vi.fn();

      await delegateOperatorCommand(
        { apiUrl: "http://localhost:3000" },
        {
          rawInput: "do something",
          channel: "telegram",
          operatorId: "op-1",
          organizationId: "org-1",
          sendReply,
        },
      );

      expect(sendReply).toHaveBeenCalledWith(expect.stringContaining("went wrong"));

      vi.unstubAllGlobals();
    });
  });
});
