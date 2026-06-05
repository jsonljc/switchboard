"use client";

import { useState } from "react";
import type { MiraBriefGoal, MiraBriefVibe } from "@switchboard/schemas";
import { classifyBriefIntent } from "@switchboard/schemas";
import { useCreateCreativeDraftRequest } from "@/hooks/use-create-creative-draft-request";
import { useHalt } from "@/components/layout/halt/halt-context";
import { MIRA_ACCENT } from "@/lib/cockpit/mira/mira-config";
import { T } from "@/components/cockpit/tokens";
import {
  BRIEF_HEADING_EMPTY,
  BRIEF_PROMOTING_LABEL,
  BRIEF_PROMOTING_PLACEHOLDER,
  BRIEF_EXAMPLES,
  GOAL_LABEL,
  VIBE_LABEL,
  intentSummary,
  BRIEF_OFFSCOPE_REDIRECT,
} from "@/lib/cockpit/mira/desk-copy";

const PROMOTING_FIELD_ID = "mira-brief-promoting";

const GOALS = Object.keys(GOAL_LABEL) as MiraBriefGoal[];
const VIBES = Object.keys(VIBE_LABEL) as MiraBriefVibe[];

type Phase = "edit" | "preview" | "offscope" | "submitted";

// Hybrid open-brief: one required line + Goal/Vibe chips + example chips, then an
// Intent-Preview readback that IS the cost-confirm (the mutation never fires
// before [Make the draft]) and doubles as the off-scope redirect.
export function MiraBriefBox() {
  const { halted } = useHalt();
  const create = useCreateCreativeDraftRequest();
  const [promoting, setPromoting] = useState("");
  const [goal, setGoal] = useState<MiraBriefGoal>("more_bookings");
  const [vibe, setVibe] = useState<MiraBriefVibe>("warm");
  const [mode, setMode] = useState<"polished" | "ugc">("polished");
  const [phase, setPhase] = useState<Phase>("edit");

  const canPreview = promoting.trim().length > 0 && !halted;

  function preview() {
    if (!canPreview) return;
    setPhase(classifyBriefIntent(promoting) === "off_scope" ? "offscope" : "preview");
  }

  async function makeTheDraft() {
    try {
      await create.mutateAsync({ promoting: promoting.trim(), goal, vibe, mode });
    } catch {
      return; // create.isError is set by the mutation; stay on preview so the user can retry
    }
    setPhase("submitted");
    setPromoting("");
  }

  const chip = (active: boolean) => ({
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${active ? MIRA_ACCENT.deep : T.hair}`,
    background: active ? MIRA_ACCENT.deep : "transparent",
    color: active ? T.actionFg : T.ink2,
  });
  const btn = {
    padding: "8px 16px",
    borderRadius: 4,
    border: `1px solid ${T.amberDeep}`,
    background: T.amber,
    color: T.actionFg,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  } as const;

  return (
    <section
      aria-label="Brief Mira"
      style={{
        background: T.paper,
        borderRadius: 8,
        padding: 16,
        border: `1px solid ${T.hair}`,
      }}
    >
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: T.ink,
        }}
      >
        {BRIEF_HEADING_EMPTY}
      </h2>

      {phase === "preview" ? (
        <div style={{ background: MIRA_ACCENT.paper, borderRadius: 8, padding: 12 }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: T.ink2 }}>
            {intentSummary(promoting, GOAL_LABEL[goal], VIBE_LABEL[vibe])}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={create.isPending} onClick={makeTheDraft} style={btn}>
              Make the draft
            </button>
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => setPhase("edit")}
              style={{
                ...btn,
                background: T.paper,
                border: `1px solid ${T.hair}`,
                color: T.ink,
                fontWeight: 500,
              }}
            >
              Tweak
            </button>
          </div>
          {create.isError && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: T.red }}>
              Couldn&apos;t start the draft. Try again.
            </p>
          )}
        </div>
      ) : phase === "offscope" ? (
        <div style={{ background: MIRA_ACCENT.paper, borderRadius: 8, padding: 12 }}>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: T.ink2 }}>
            {BRIEF_OFFSCOPE_REDIRECT}
          </p>
          <button type="button" onClick={() => setPhase("edit")} style={btn}>
            Edit the brief
          </button>
        </div>
      ) : (
        <>
          <label
            htmlFor={PROMOTING_FIELD_ID}
            style={{ display: "block", fontSize: 12, color: T.ink3, marginBottom: 4 }}
          >
            {BRIEF_PROMOTING_LABEL}
          </label>
          <textarea
            id={PROMOTING_FIELD_ID}
            placeholder={BRIEF_PROMOTING_PLACEHOLDER}
            value={promoting}
            onChange={(e) => {
              setPromoting(e.target.value);
              if (phase === "submitted") setPhase("edit");
            }}
            rows={2}
            style={{
              width: "100%",
              resize: "vertical",
              borderRadius: 8,
              border: `1px solid ${T.hair}`,
              background: T.paper,
              color: T.ink,
              padding: 10,
              fontSize: 14,
              fontFamily: "inherit",
            }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {BRIEF_EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setPromoting(ex)} style={chip(false)}>
                {ex}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {GOALS.map((g) => (
              <button key={g} type="button" onClick={() => setGoal(g)} style={chip(g === goal)}>
                {GOAL_LABEL[g]}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {VIBES.map((v) => (
              <button key={v} type="button" onClick={() => setVibe(v)} style={chip(v === vibe)}>
                {VIBE_LABEL[v]}
              </button>
            ))}
          </div>
          {/* Format toggle (slice-3 spec 3.4): Polished = the assembled multi-scene
              ad; Real-talk = a single creator-style clip (ugc mode). */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setMode("polished")}
              style={chip(mode === "polished")}
            >
              Polished
            </button>
            <button type="button" onClick={() => setMode("ugc")} style={chip(mode === "ugc")}>
              Real-talk
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              disabled={!canPreview}
              onClick={preview}
              style={{
                ...btn,
                background: canPreview ? T.amber : T.ink5,
                border: `1px solid ${canPreview ? T.amberDeep : T.ink5}`,
                cursor: canPreview ? "pointer" : "not-allowed",
              }}
            >
              Preview
            </button>
            {halted && (
              <span style={{ fontSize: 12, color: T.red }}>Resume Mira to brief her.</span>
            )}
            {phase === "submitted" && (
              <span style={{ fontSize: 13, color: MIRA_ACCENT.base }}>
                Mira is on it. She started a draft. You&apos;ll review it before anything goes
                further.
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
