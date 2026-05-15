import { describe, expect, it } from "vitest";
import { toastVoice } from "../alex-toast-voice";
import type { ParsedAction } from "@/components/cockpit/types";

function action(kind: ParsedAction["kind"], extras: Partial<ParsedAction> = {}): ParsedAction {
  return {
    kind,
    icon: "·",
    label: kind,
    detail: extras.detail ?? "",
    raw: extras.raw ?? "",
    ...extras,
  };
}

describe("toastVoice", () => {
  it("pause has title + description", () => {
    const t = toastVoice(action("pause", { detail: "until 3 PM" }));
    expect(t.title).toMatch(/Paused/);
    expect(t.description).toBe("until 3 PM");
  });

  it("resume", () => {
    expect(toastVoice(action("resume")).title).toMatch(/Resumed/);
  });

  it("halt", () => {
    expect(toastVoice(action("halt")).title).toMatch(/Halted/);
  });

  it("brief is a stub with deferred-cron description", () => {
    const t = toastVoice(action("brief"));
    expect(t.title).toMatch(/stub/i);
    expect(t.description).toMatch(/scheduled briefs/i);
  });

  it("rule echoes detail", () => {
    const t = toastVoice(action("rule", { detail: "stop offering founder rate" }));
    expect(t.title).toMatch(/rules/i);
    expect(t.description).toBe("stop offering founder rate");
  });

  it("handoff names the contact", () => {
    const t = toastVoice(action("handoff", { label: "handoff · Maya" }));
    expect(t.title).toMatch(/Maya/);
  });

  it("context names the contact", () => {
    const t = toastVoice(action("context", { label: "context · Jordan" }));
    expect(t.title).toMatch(/Jordan/);
  });

  it("followup is a stub", () => {
    const t = toastVoice(action("followup"));
    expect(t.title).toMatch(/stub/i);
    expect(t.description).toMatch(/scheduled followups/i);
  });

  it("instruction echoes detail in description", () => {
    const t = toastVoice(action("instruction", { detail: "do the thing" }));
    expect(t.title).toBe("Got it.");
    expect(t.description).toBe('Acting on "do the thing".');
  });

  it("command falls back to On it · label", () => {
    const t = toastVoice(action("command", { label: "Open settings" }));
    expect(t.title).toMatch(/On it/);
    expect(t.title).toMatch(/Open settings/);
  });
});
