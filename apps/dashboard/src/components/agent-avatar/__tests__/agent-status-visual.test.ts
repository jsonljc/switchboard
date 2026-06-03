import { describe, it, expect } from "vitest";
import { agentVisualState } from "../agent-status-visual";

describe("agentVisualState", () => {
  it("halted overrides everything -> sleep / locked / not playing", () => {
    expect(agentVisualState("working", true)).toEqual({
      spriteState: "sleep",
      pip: "locked",
      playing: false,
    });
    expect(agentVisualState("idle", true)).toEqual({
      spriteState: "sleep",
      pip: "locked",
      playing: false,
    });
  });

  it("working and analyzing -> draft / active / playing", () => {
    expect(agentVisualState("working", false)).toEqual({
      spriteState: "draft",
      pip: "active",
      playing: true,
    });
    expect(agentVisualState("analyzing", false)).toEqual({
      spriteState: "draft",
      pip: "active",
      playing: true,
    });
  });

  it("waiting_approval -> idle sprite / attention pip / not playing", () => {
    expect(agentVisualState("waiting_approval", false)).toEqual({
      spriteState: "idle",
      pip: "attention",
      playing: false,
    });
  });

  it("error -> idle sprite / attention pip / not playing", () => {
    expect(agentVisualState("error", false)).toEqual({
      spriteState: "idle",
      pip: "attention",
      playing: false,
    });
  });

  it("idle -> idle / idle / not playing", () => {
    expect(agentVisualState("idle", false)).toEqual({
      spriteState: "idle",
      pip: "idle",
      playing: false,
    });
  });
});
