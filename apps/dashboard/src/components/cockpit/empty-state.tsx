// apps/dashboard/src/components/cockpit/empty-state.tsx
"use client";

import { T } from "./tokens";
import { SpriteFrame } from "./sprite/sprite-frame";
import type { SpriteVariantKey, VariantBundle } from "./sprite/types";
import type { MissionAggregatorResponse } from "@/lib/cockpit/mission-types";

const DEFAULT_PRICE = 89;
const DEFAULT_REFUND = 200;

const SETUP_LABEL: Record<MissionAggregatorResponse["setup"][number]["key"], string> = {
  meta: "Connect Meta Ads",
  inbox: "Connect your inbox",
  cal: "Connect consultation calendar",
  rules: "Review pricing & escalation",
};

const SETUP_HINT: Record<MissionAggregatorResponse["setup"][number]["key"], string> = {
  meta: "Where leads come from",
  inbox: "Where Alex replies from",
  cal: "Where bookings land",
  rules: "Pulled from onboarding",
};

export function shouldRenderEmptyState(setup: MissionAggregatorResponse["setup"]): boolean {
  if (setup.length === 0) return false;
  return setup.every((row) => !row.done);
}

type Props = {
  rules: MissionAggregatorResponse["mission"]["rules"];
  setup: MissionAggregatorResponse["setup"];
  onConnect: (key: MissionAggregatorResponse["setup"][number]["key"]) => void;
  /** Sprite bundle for the narrator avatar. When omitted, renders letter "A". */
  bundle?: VariantBundle;
  /** Sprite variant key into the bundle. */
  variant?: SpriteVariantKey;
};

const eyebrowStyle = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
};

export function EmptyState({ rules, setup, onConnect, bundle, variant }: Props) {
  const price = rules?.priceApprovalThreshold ?? DEFAULT_PRICE;
  const refund = rules?.refundEscalationFloor ?? DEFAULT_REFUND;
  const primary = setup.find((row) => row.primary);
  const doneCount = setup.filter((row) => row.done).length;

  return (
    <section
      data-testid="cockpit-empty-state"
      style={{
        padding: "12px 28px 32px",
        color: T.ink,
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {/* Narrator block — agent voice */}
      <article
        style={{
          padding: "20px 24px",
          background: T.amberPaper,
          border: `1px solid ${T.amberSoft}`,
          borderRadius: 8,
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        {bundle && variant ? (
          <SpriteFrame
            bundle={bundle}
            variant={variant}
            state="idle"
            size={48}
            accentSoft={T.amberSoft}
            fallbackDeep={T.amberDeep}
            fallbackLetter="A"
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              borderRadius: 9,
              background: T.amberSoft,
              border: `1px solid ${T.hair}`,
              display: "grid",
              placeItems: "center",
              color: T.amberDeep,
              fontSize: 22,
              fontWeight: 700,
              flexShrink: 0,
              boxShadow: "inset 0 -8px 14px rgba(14,12,10,0.04)",
            }}
          >
            A
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...eyebrowStyle, color: T.amberDeep }}>Alex · just now</div>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 15,
              lineHeight: 1.5,
              color: T.ink,
              maxWidth: 580,
            }}
          >
            I'm set up and quiet. Connect Meta Ads and I'll pull the first leads in under a minute.
          </p>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 15,
              lineHeight: 1.5,
              color: T.ink2,
              maxWidth: 580,
            }}
          >
            So Alex can qualify inbound leads and book consultations under your standing rules. Alex
            will only interrupt you for pricing decisions over ${price} and refunds over ${refund}.
          </p>
          {primary && (
            <div
              style={{
                marginTop: 14,
                padding: "8px 12px",
                background: "rgba(255,255,255,0.55)",
                borderRadius: 4,
                border: `1px solid ${T.amberSoft}`,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                data-testid="next-move-pill"
                style={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 10,
                  color: T.amberDeep,
                  letterSpacing: "0.1em",
                }}
              >
                NEXT MOVE
              </span>
              <span style={{ fontSize: 13, color: T.ink2 }}>{SETUP_LABEL[primary.key]}</span>
            </div>
          )}
        </div>
      </article>

      {/* Setup checklist */}
      <div
        style={{
          padding: "18px 22px",
          background: T.paper,
          border: `1px solid ${T.hair}`,
          borderRadius: 8,
        }}
      >
        <div style={{ ...eyebrowStyle, color: T.ink3 }}>
          Setup · {doneCount} of {setup.length} ready
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {setup.map((row, i) => (
            <li
              key={row.key}
              data-testid={`setup-row-${row.key}`}
              data-primary={row.primary ? "true" : "false"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 0",
                borderTop: i === 0 ? "none" : `1px solid ${T.hairSoft}`,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  border: `1.5px solid ${row.done ? T.green : T.ink5}`,
                  background: row.done ? T.green : "transparent",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {row.done ? "✓" : ""}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: row.done ? 400 : 500,
                    color: row.done ? T.ink3 : T.ink,
                    textDecoration: row.done ? "line-through" : "none",
                  }}
                >
                  {SETUP_LABEL[row.key]}
                </div>
                <div style={{ fontSize: 12, color: T.ink4, marginTop: 1 }}>
                  {SETUP_HINT[row.key]}
                </div>
              </div>
              {!row.done && (
                <button
                  type="button"
                  onClick={() => onConnect(row.key)}
                  style={{
                    background: row.primary ? T.ink : "transparent",
                    color: row.primary ? "#fff" : T.ink,
                    border: row.primary ? `1px solid ${T.ink}` : `1px solid ${T.hair}`,
                    padding: "7px 14px",
                    borderRadius: 4,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {row.primary ? "Connect →" : "Connect"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
