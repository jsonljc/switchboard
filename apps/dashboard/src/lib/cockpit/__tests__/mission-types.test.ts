// apps/dashboard/src/lib/cockpit/__tests__/mission-types.test.ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  MissionAggregatorResponse,
  MissionChannel,
  MissionChannelKind,
  MissionChannelStatus,
  MissionRules,
  MissionSetupRow,
  MissionTargets,
} from "../mission-types";

describe("cockpit mission types", () => {
  it("MissionChannelKind covers the five canonical kinds", () => {
    expectTypeOf<MissionChannelKind>().toEqualTypeOf<
      "meta-ads" | "whatsapp" | "telegram" | "slack" | "calendar"
    >();
  });

  it("MissionChannelStatus is the three-state union", () => {
    expectTypeOf<MissionChannelStatus>().toEqualTypeOf<"ok" | "warn" | "off">();
  });

  it("MissionRules is nullable", () => {
    expectTypeOf<MissionRules>().toEqualTypeOf<{
      priceApprovalThreshold: number;
      refundEscalationFloor: number;
    } | null>();
  });

  it("MissionSetupRow exposes key/done/primary?", () => {
    expectTypeOf<MissionSetupRow>().toEqualTypeOf<{
      key: "meta" | "inbox" | "cal" | "rules";
      done: boolean;
      primary?: boolean;
    }>();
  });

  it("MissionTargets carries the three v1 fields", () => {
    expectTypeOf<MissionTargets>().toEqualTypeOf<{
      avgValueCents: number | null;
      targetCpbCents: number | null;
      roasSource: "deterministic" | "crm";
    }>();
  });

  it("MissionAggregatorResponse composes the above into the wire shape", () => {
    expectTypeOf<MissionAggregatorResponse>().toMatchTypeOf<{
      agentKey: "alex" | "riley";
      displayName: string;
      mission: {
        role: string;
        pipeline: string;
        brand: string;
        channels: MissionChannel[];
        rules: MissionRules;
      };
      composerPlaceholder: string;
      commands: never[];
      targets: MissionTargets;
      setup: MissionSetupRow[];
    }>();
  });
});
