# Agent Config Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-agent configuration page at `/team/[agentId]` with personality (tone) and behavior settings that map to real backend config keys.

**Architecture:** Three-column page (personality / agent identity / behavior) replaces the existing `AgentDetailSheet` slide-over. Uses existing `useAgentRoster()` + `useUpdateAgentRoster()` hooks to read/write config. No new backend endpoints or hooks needed.

**Tech Stack:** Next.js 14 (App Router), React, TanStack Query, Tailwind CSS, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-23-agent-config-page-design.md`

---

## File Structure

```
apps/dashboard/src/
  components/team/
    agent-behavior-options.ts          -- CREATE: Per-role behavior option definitions
    agent-preview-templates.ts         -- CREATE: Preview message generators per role
    agent-config-personality.tsx        -- CREATE: Left column component
    agent-config-identity.tsx           -- CREATE: Center column component
    agent-config-behavior.tsx           -- CREATE: Right column component
    agent-detail-sheet.tsx             -- DELETE: Replaced by config page
    agent-card.tsx                     -- KEEP: No changes (unused by team page, used elsewhere)
  app/team/
    page.tsx                           -- MODIFY: Remove sheet, add router.push navigation
    [agentId]/
      page.tsx                         -- CREATE: Config page
  components/onboarding/
    step-agent-style.tsx               -- MODIFY: Import preview from shared file
```

---

### Task 1: Behavior Options Data

**Files:**
- Create: `apps/dashboard/src/components/team/agent-behavior-options.ts`
- Test: `apps/dashboard/src/components/team/__tests__/agent-behavior-options.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/dashboard/src/components/team/__tests__/agent-behavior-options.test.ts
import { describe, it, expect } from "vitest";
import {
  getBehaviorOptions,
  getRoleDescription,
  type BehaviorOption,
} from "../agent-behavior-options";

describe("getBehaviorOptions", () => {
  it("returns qualification threshold options for responder", () => {
    const options = getBehaviorOptions("responder");
    expect(options).toHaveLength(1);
    expect(options[0].configKey).toBe("qualificationThreshold");
    expect(options[0].choices).toHaveLength(3);
    expect(options[0].choices[1].value).toBe(40); // balanced = default
  });

  it("returns followUpDays options for strategist", () => {
    const options = getBehaviorOptions("strategist");
    expect(options).toHaveLength(1);
    expect(options[0].configKey).toBe("followUpDays");
    expect(options[0].choices[1].value).toEqual([1, 3, 7]); // steady = default
  });

  it("returns approvalThreshold options for optimizer", () => {
    const options = getBehaviorOptions("optimizer");
    expect(options).toHaveLength(1);
    expect(options[0].configKey).toBe("approvalThreshold");
    expect(options[0].choices[0].value).toBe(50);
  });

  it("returns empty array for roles without behavior options", () => {
    expect(getBehaviorOptions("booker")).toEqual([]);
    expect(getBehaviorOptions("monitor")).toEqual([]);
    expect(getBehaviorOptions("guardian")).toEqual([]);
    expect(getBehaviorOptions("primary_operator")).toEqual([]);
  });

  it("returns empty array for unknown role", () => {
    expect(getBehaviorOptions("unknown_role")).toEqual([]);
  });
});

describe("getRoleDescription", () => {
  it("returns description for roles without behavior options", () => {
    expect(getRoleDescription("booker")).toBeTruthy();
    expect(getRoleDescription("primary_operator")).toContain("Coordinates");
  });

  it("returns null for roles with behavior options", () => {
    expect(getRoleDescription("responder")).toBeNull();
    expect(getRoleDescription("strategist")).toBeNull();
    expect(getRoleDescription("optimizer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- agent-behavior-options`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the module**

```typescript
// apps/dashboard/src/components/team/agent-behavior-options.ts

export interface BehaviorChoice {
  id: string;
  label: string;
  description: string;
  value: unknown;
}

export interface BehaviorOption {
  configKey: string;
  label: string;
  choices: BehaviorChoice[];
}

const RESPONDER_OPTIONS: BehaviorOption[] = [
  {
    configKey: "qualificationThreshold",
    label: "How thorough?",
    choices: [
      { id: "light", label: "Speed run", description: "Fewer questions, faster handoff", value: 25 },
      { id: "balanced", label: "Balanced", description: "Standard qualification", value: 40 },
      { id: "deep", label: "Deep dive", description: "More questions, budget & timeline", value: 60 },
    ],
  },
];

const STRATEGIST_OPTIONS: BehaviorOption[] = [
  {
    configKey: "followUpDays",
    label: "Follow-up style",
    choices: [
      { id: "gentle", label: "Gentle", description: "Spaced out, low pressure", value: [2, 5, 10] },
      { id: "steady", label: "Steady", description: "Regular check-ins", value: [1, 3, 7] },
      { id: "relentless", label: "Relentless", description: "Frequent, high urgency", value: [1, 2, 4] },
    ],
  },
];

const OPTIMIZER_OPTIONS: BehaviorOption[] = [
  {
    configKey: "approvalThreshold",
    label: "Spend authority",
    choices: [
      { id: "cautious", label: "Check with me first", description: "Over $50 needs approval", value: 50 },
      { id: "moderate", label: "I trust your judgment", description: "Over $200 needs approval", value: 200 },
      { id: "autonomous", label: "Go for it", description: "Over $500 needs approval", value: 500 },
    ],
  },
];

const ROLE_OPTIONS: Record<string, BehaviorOption[]> = {
  responder: RESPONDER_OPTIONS,
  strategist: STRATEGIST_OPTIONS,
  optimizer: OPTIMIZER_OPTIONS,
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  booker: "Schedules appointments based on your availability settings.",
  monitor: "Tracks revenue and flags issues automatically.",
  guardian: "Reviews risky actions before they execute.",
  primary_operator: "Coordinates the team. Its behavior is shaped by each specialist's settings.",
};

export function getBehaviorOptions(agentRole: string): BehaviorOption[] {
  return ROLE_OPTIONS[agentRole] ?? [];
}

export function getRoleDescription(agentRole: string): string | null {
  if (ROLE_OPTIONS[agentRole]) return null;
  return ROLE_DESCRIPTIONS[agentRole] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- agent-behavior-options`
Expected: PASS

- [ ] **Step 5: Commit**

```
git commit -m "feat: add agent behavior options data module"
```

---

### Task 2: Preview Templates

**Files:**
- Create: `apps/dashboard/src/components/team/agent-preview-templates.ts`
- Test: `apps/dashboard/src/components/team/__tests__/agent-preview-templates.test.ts`
- Modify: `apps/dashboard/src/components/onboarding/step-agent-style.tsx` (import from shared file)

- [ ] **Step 1: Write the test**

```typescript
// apps/dashboard/src/components/team/__tests__/agent-preview-templates.test.ts
import { describe, it, expect } from "vitest";
import { getPreviewMessage } from "../agent-preview-templates";

describe("getPreviewMessage", () => {
  it("generates warm greeting for responder", () => {
    const msg = getPreviewMessage("responder", "warm-professional", {}, "Acme Clinic");
    expect(msg).toContain("Acme Clinic");
    expect(msg).toContain("Welcome");
  });

  it("generates casual greeting for responder", () => {
    const msg = getPreviewMessage("responder", "casual-conversational", {}, "Acme Clinic");
    expect(msg).toContain("Hey");
  });

  it("generates direct greeting for responder", () => {
    const msg = getPreviewMessage("responder", "direct-efficient", {}, "Acme Clinic");
    expect(msg).toContain("Hello");
  });

  it("includes qualification depth for responder with deep config", () => {
    const msg = getPreviewMessage("responder", "warm-professional", { qualificationThreshold: 60 }, "Acme");
    expect(msg).toContain("budget");
  });

  it("includes follow-up timing for strategist", () => {
    const msg = getPreviewMessage("strategist", "casual-conversational", { followUpDays: [1, 2, 4] }, "Acme");
    expect(msg).toContain("tomorrow");
  });

  it("includes threshold for optimizer", () => {
    const msg = getPreviewMessage("optimizer", "warm-professional", { approvalThreshold: 200 }, "Acme");
    expect(msg).toContain("$200");
  });

  it("generates tone-only greeting for booker", () => {
    const msg = getPreviewMessage("booker", "warm-professional", {}, "Acme");
    expect(msg).toBeTruthy();
  });

  it("uses fallback business name when empty", () => {
    const msg = getPreviewMessage("responder", "warm-professional", {}, "");
    expect(msg).toContain("your business");
  });

  it("handles onboarding agent IDs (lead-responder -> responder)", () => {
    const msg = getPreviewMessage("lead-responder", "warm-professional", {}, "Acme");
    expect(msg).toContain("Acme");
    expect(msg).toContain("Welcome");
  });

  it("handles onboarding agent IDs (sales-closer -> strategist)", () => {
    const msg = getPreviewMessage("sales-closer", "casual-conversational", { followUpDays: [1, 3, 7] }, "Acme");
    expect(msg).toContain("checking in");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/dashboard test -- agent-preview-templates`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the module**

```typescript
// apps/dashboard/src/components/team/agent-preview-templates.ts

type TonePreset = "warm-professional" | "casual-conversational" | "direct-efficient";

const GREETINGS: Record<TonePreset, (name: string) => string> = {
  "warm-professional": (n) =>
    `"Hi there! Welcome to ${n}. I'd love to help you find the perfect service. What are you looking for today?"`,
  "casual-conversational": (n) =>
    `"Hey! Thanks for reaching out to ${n}. What can I help you with?"`,
  "direct-efficient": (n) =>
    `"Hello. How can I assist you with ${n}'s services today?"`,
};

const QUALIFICATION_SUFFIX: Record<string, string> = {
  light: `"Great — let me connect you with someone who can help right away."`,
  deep: `"To find the best fit, could you share your budget range and preferred timeline?"`,
};

const FOLLOW_UP_TEMPLATES: Record<TonePreset, (days: number) => string> = {
  "warm-professional": (d) =>
    `"Hi again! Just wanted to follow up from our chat. I'll check back in ${d === 1 ? "tomorrow" : `${d} days`} if I don't hear from you."`,
  "casual-conversational": (d) =>
    `"Hey! Just checking in. I'll ping you again ${d === 1 ? "tomorrow" : `in ${d} days`} if needed."`,
  "direct-efficient": (d) =>
    `"Following up on our conversation. Next check-in: ${d === 1 ? "tomorrow" : `${d} days`}."`,
};

const OPTIMIZER_TEMPLATES: Record<TonePreset, (threshold: number) => string> = {
  "warm-professional": (t) =>
    `"I noticed campaign 'Summer Sale' is underperforming. I'll adjust spend up to $${t} on my own — anything larger, I'll check with you first."`,
  "casual-conversational": (t) =>
    `"Heads up — 'Summer Sale' isn't doing great. I can tweak up to $${t} without bothering you. Bigger changes, I'll ask!"`,
  "direct-efficient": (t) =>
    `"Campaign 'Summer Sale' underperforming. Auto-adjusting spend up to $${t}. Larger changes require your approval."`,
};

// Map onboarding agent IDs (e.g. "lead-responder") to roster roles (e.g. "responder")
const ONBOARDING_TO_ROLE: Record<string, string> = {
  "lead-responder": "responder",
  "sales-closer": "strategist",
  "ad-optimizer": "optimizer",
  "revenue-tracker": "monitor",
  nurture: "booker", // nurture maps to booker role in roster
};

function normalizeRole(agentRole: string): string {
  return ONBOARDING_TO_ROLE[agentRole] ?? agentRole;
}

export function getPreviewMessage(
  agentRole: string,
  tonePreset: string,
  config: Record<string, unknown>,
  businessName: string,
): string {
  const role = normalizeRole(agentRole);
  const tone = (tonePreset || "warm-professional") as TonePreset;
  const name = businessName || "your business";

  if (role === "responder") {
    const greeting = GREETINGS[tone](name);
    const threshold = config.qualificationThreshold as number | undefined;
    if (threshold !== undefined && threshold <= 25) return `${greeting}\n\n${QUALIFICATION_SUFFIX.light}`;
    if (threshold !== undefined && threshold >= 60) return `${greeting}\n\n${QUALIFICATION_SUFFIX.deep}`;
    return greeting;
  }

  if (role === "strategist") {
    const days = config.followUpDays as number[] | undefined;
    const firstDay = days?.[0] ?? 1;
    return FOLLOW_UP_TEMPLATES[tone](firstDay);
  }

  if (role === "optimizer") {
    const threshold = (config.approvalThreshold as number) ?? 200;
    return OPTIMIZER_TEMPLATES[tone](threshold);
  }

  // All other roles: tone-only greeting
  return GREETINGS[tone](name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @switchboard/dashboard test -- agent-preview-templates`
Expected: PASS

- [ ] **Step 5: Update onboarding to import from shared file**

In `apps/dashboard/src/components/onboarding/step-agent-style.tsx`:

Replace the private `getPreviewGreeting()` function (lines 52-64) with an import:

```typescript
import { getPreviewMessage } from "@/components/team/agent-preview-templates";
```

Then replace the usage at line 128:
```typescript
// Before:
{getPreviewGreeting(selectedTone, businessName)}

// After:
{getPreviewMessage(agentId, selectedTone, {}, businessName)}
```

Delete the `getPreviewGreeting` function (lines 52-64).

- [ ] **Step 6: Run onboarding tests to verify nothing broke**

Run: `pnpm --filter @switchboard/dashboard test -- step-agent-style`
Expected: PASS (or update test if it referenced the old function)

- [ ] **Step 7: Commit**

```
git commit -m "feat: add agent preview templates with shared onboarding import"
```

---

### Task 3: Personality Column Component

**Files:**
- Create: `apps/dashboard/src/components/team/agent-config-personality.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/dashboard/src/components/team/agent-config-personality.tsx
"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AgentConfigPersonalityProps {
  displayName: string;
  tonePreset: string;
  onDisplayNameChange: (name: string) => void;
  onToneChange: (tone: string) => void;
}

const TONES = [
  { id: "warm-professional", label: "Warm", description: "Friendly & reassuring" },
  { id: "casual-conversational", label: "Casual", description: "Relaxed & approachable" },
  { id: "direct-efficient", label: "Direct", description: "Brief & to the point" },
] as const;

export function AgentConfigPersonality({
  displayName,
  tonePreset,
  onDisplayNameChange,
  onToneChange,
}: AgentConfigPersonalityProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-[13px] font-medium text-foreground">Name</Label>
        <Input
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          className="text-[14px]"
          placeholder="Agent name"
        />
      </div>

      <div className="space-y-3">
        <Label className="text-[13px] font-medium text-foreground">Personality</Label>
        <div className="space-y-2">
          {TONES.map((tone) => (
            <button
              key={tone.id}
              onClick={() => onToneChange(tone.id)}
              className={cn(
                "w-full text-left px-4 py-3 rounded-lg border transition-all",
                tonePreset === tone.id
                  ? "border-foreground/30 bg-muted/50"
                  : "border-border hover:border-foreground/15",
              )}
            >
              <p className="text-[13px] font-medium text-foreground">{tone.label}</p>
              <p className="text-[12px] text-muted-foreground">{tone.description}</p>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: No errors related to `agent-config-personality`

- [ ] **Step 3: Commit**

```
git commit -m "feat: add agent config personality column component"
```

---

### Task 4: Identity Column Component

**Files:**
- Create: `apps/dashboard/src/components/team/agent-config-identity.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/dashboard/src/components/team/agent-config-identity.tsx
"use client";

import { AGENT_ICONS, AGENT_ROLE_LABELS } from "./agent-icons";
import { cn } from "@/lib/utils";

interface AgentConfigIdentityProps {
  agentRole: string;
  displayName: string;
  activityStatus: string;
  metrics: Record<string, unknown>;
  previewText: string;
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  idle: { dot: "bg-agent-idle", label: "Ready" },
  working: { dot: "bg-agent-active animate-pulse", label: "Working" },
  analyzing: { dot: "bg-agent-active animate-pulse", label: "Analyzing" },
  waiting_approval: { dot: "bg-agent-attention animate-pulse", label: "Waiting" },
  error: { dot: "bg-destructive animate-pulse", label: "Error" },
};

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AgentConfigIdentity({
  agentRole,
  displayName,
  activityStatus,
  metrics,
  previewText,
}: AgentConfigIdentityProps) {
  const Icon = AGENT_ICONS[agentRole] ?? AGENT_ICONS.primary_operator;
  const roleLabel = AGENT_ROLE_LABELS[agentRole] ?? agentRole;
  const statusStyle = STATUS_STYLES[activityStatus] ?? STATUS_STYLES.idle;

  const activeConversations = metrics.activeConversations as number | undefined;
  const actionsToday = metrics.actionsToday as number | undefined;
  const lastActiveAt = metrics.lastActiveAt as string | undefined;

  return (
    <div className="flex flex-col items-center text-center space-y-4">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>

      <div>
        <h2 className="text-[17px] font-semibold text-foreground">{displayName}</h2>
        <p className="text-[13px] text-muted-foreground">{roleLabel}</p>
      </div>

      <div className="flex items-center gap-1.5">
        <div className={cn("h-[7px] w-[7px] rounded-full", statusStyle.dot)} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {statusStyle.label}
        </span>
      </div>

      {(activeConversations != null || actionsToday != null || lastActiveAt) && (
        <div className="flex flex-wrap justify-center gap-4 text-[12px] text-muted-foreground">
          {activeConversations != null && (
            <span>{activeConversations} active chats</span>
          )}
          {actionsToday != null && (
            <span>{actionsToday} actions today</span>
          )}
          {lastActiveAt && (
            <span>Last active {formatTimeAgo(lastActiveAt)}</span>
          )}
        </div>
      )}

      {/* Preview bubble */}
      {previewText && (
        <div className="w-full mt-2 rounded-lg bg-muted/50 border border-border/50 p-4">
          <p className="text-[12px] text-muted-foreground mb-1">Preview</p>
          <p className="text-[13px] text-foreground italic leading-relaxed whitespace-pre-line">
            {previewText}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```
git commit -m "feat: add agent config identity column component"
```

---

### Task 5: Behavior Column Component

**Files:**
- Create: `apps/dashboard/src/components/team/agent-config-behavior.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/dashboard/src/components/team/agent-config-behavior.tsx
"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getBehaviorOptions,
  getRoleDescription,
  type BehaviorOption,
  type BehaviorChoice,
} from "./agent-behavior-options";

interface AgentConfigBehaviorProps {
  agentRole: string;
  config: Record<string, unknown>;
  onConfigChange: (key: string, value: unknown) => void;
}

function findSelectedChoice(option: BehaviorOption, currentValue: unknown): string {
  // Match by value — handle arrays and primitives
  const match = option.choices.find((c) => {
    if (Array.isArray(c.value) && Array.isArray(currentValue)) {
      return JSON.stringify(c.value) === JSON.stringify(currentValue);
    }
    return c.value === currentValue;
  });
  // Default to middle option if no match
  return match?.id ?? option.choices[1]?.id ?? option.choices[0]?.id ?? "";
}

function OptionGroup({
  option,
  selectedId,
  onSelect,
}: {
  option: BehaviorOption;
  selectedId: string;
  onSelect: (choice: BehaviorChoice) => void;
}) {
  return (
    <div className="space-y-3">
      <Label className="text-[13px] font-medium text-foreground">{option.label}</Label>
      <div className="space-y-2">
        {option.choices.map((choice) => (
          <button
            key={choice.id}
            onClick={() => onSelect(choice)}
            className={cn(
              "w-full text-left px-4 py-3 rounded-lg border transition-all",
              selectedId === choice.id
                ? "border-foreground/30 bg-muted/50"
                : "border-border hover:border-foreground/15",
            )}
          >
            <p className="text-[13px] font-medium text-foreground">{choice.label}</p>
            <p className="text-[12px] text-muted-foreground">{choice.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentConfigBehavior({
  agentRole,
  config,
  onConfigChange,
}: AgentConfigBehaviorProps) {
  const options = getBehaviorOptions(agentRole);
  const roleDescription = getRoleDescription(agentRole);

  if (roleDescription) {
    return (
      <div className="space-y-4">
        <Label className="text-[13px] font-medium text-foreground">About this agent</Label>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{roleDescription}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {options.map((option) => (
        <OptionGroup
          key={option.configKey}
          option={option}
          selectedId={findSelectedChoice(option, config[option.configKey])}
          onSelect={(choice) => onConfigChange(option.configKey, choice.value)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```
git commit -m "feat: add agent config behavior column component"
```

---

### Task 6: Config Page

**Files:**
- Create: `apps/dashboard/src/app/team/[agentId]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
// apps/dashboard/src/app/team/[agentId]/page.tsx
"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAgentRoster, useUpdateAgentRoster, useAgentState } from "@/hooks/use-agents";
import { useToast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentConfigPersonality } from "@/components/team/agent-config-personality";
import { AgentConfigIdentity } from "@/components/team/agent-config-identity";
import { AgentConfigBehavior } from "@/components/team/agent-config-behavior";
import { getPreviewMessage } from "@/components/team/agent-preview-templates";

export default function AgentConfigPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const { status } = useSession();
  const { data: rosterData, isLoading } = useAgentRoster();
  useAgentState();
  const updateRoster = useUpdateAgentRoster();
  const { toast } = useToast();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agent = rosterData?.roster.find((a) => a.id === agentId);

  // Local state for optimistic editing
  const [displayName, setDisplayName] = useState("");
  const [tonePreset, setTonePreset] = useState("warm-professional");
  const [behaviorConfig, setBehaviorConfig] = useState<Record<string, unknown>>({});

  // Initialize local state from roster data — only when agent first loads or ID changes
  const agentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (agent && agent.id !== agentIdRef.current) {
      agentIdRef.current = agent.id;
      setDisplayName(agent.displayName);
      setTonePreset((agent.config.tonePreset as string) || "warm-professional");
      setBehaviorConfig(agent.config);
    }
  }, [agent]);

  const debouncedSave = useCallback(
    (updates: { displayName?: string; config?: Record<string, unknown> }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!agent) return;
        updateRoster.mutate(
          { id: agent.id, ...updates },
          {
            onSuccess: () => toast({ title: "Saved", duration: 1500 }),
            onError: () => toast({ title: "Failed to save", variant: "destructive" }),
          },
        );
      }, 500);
    },
    [agent, updateRoster, toast],
  );

  const handleDisplayNameChange = useCallback(
    (name: string) => {
      setDisplayName(name);
      debouncedSave({ displayName: name });
    },
    [debouncedSave],
  );

  const handleToneChange = useCallback(
    (tone: string) => {
      setTonePreset(tone);
      const newConfig = { ...behaviorConfig, tonePreset: tone };
      setBehaviorConfig(newConfig);
      debouncedSave({ config: newConfig });
    },
    [behaviorConfig, debouncedSave],
  );

  const handleBehaviorChange = useCallback(
    (key: string, value: unknown) => {
      const newConfig = { ...behaviorConfig, [key]: value };
      setBehaviorConfig(newConfig);
      debouncedSave({ config: newConfig });
    },
    [behaviorConfig, debouncedSave],
  );

  if (status === "unauthenticated") redirect("/login");

  if (status === "loading" || isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-48" />
        <div className="grid gap-8 grid-cols-1 md:grid-cols-3">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push("/team")} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4 inline mr-1" />
          Back to team
        </button>
        <p className="text-[14px] text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  const activityStatus = (agent.agentState?.activityStatus as string) ?? "idle";
  const metrics = (agent.agentState?.metrics as Record<string, unknown>) ?? {};

  // Use org display name from config, or fallback to empty (preview templates handle "your business")
  const businessName = (agent.config.businessName as string) ?? "";

  const previewText = getPreviewMessage(agent.agentRole, tonePreset, behaviorConfig, businessName);

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push("/team")}
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Team
        </button>
        <span className="text-[13px] text-muted-foreground">/</span>
        <span className="text-[13px] text-foreground font-medium">{displayName}</span>
      </div>

      {/* Three-column layout */}
      <div className="grid gap-8 grid-cols-1 md:grid-cols-3">
        {/* Left: Personality */}
        <div className="order-2 md:order-1">
          <AgentConfigPersonality
            displayName={displayName}
            tonePreset={tonePreset}
            onDisplayNameChange={handleDisplayNameChange}
            onToneChange={handleToneChange}
          />
        </div>

        {/* Center: Identity */}
        <div className="order-1 md:order-2">
          <AgentConfigIdentity
            agentRole={agent.agentRole}
            displayName={displayName}
            activityStatus={activityStatus}
            metrics={metrics}
            previewText={previewText}
          />
        </div>

        {/* Right: Behavior */}
        <div className="order-3">
          <AgentConfigBehavior
            agentRole={agent.agentRole}
            config={behaviorConfig}
            onConfigChange={handleBehaviorChange}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```
git commit -m "feat: add agent config page at /team/[agentId]"
```

---

### Task 7: Update Team Page Navigation

**Files:**
- Modify: `apps/dashboard/src/app/team/page.tsx`

- [ ] **Step 1: Update the team page**

Replace the `AgentDetailSheet` interaction with `router.push` navigation.

Changes to `apps/dashboard/src/app/team/page.tsx`:

1. Remove imports:
```typescript
// REMOVE these lines:
import { useState } from "react";
import { AgentDetailSheet } from "@/components/team/agent-detail-sheet";
```

2. Add router import:
```typescript
import { useRouter } from "next/navigation";
```

3. Inside `TeamPage()`, replace:
```typescript
// REMOVE:
const [selectedAgent, setSelectedAgent] = useState<AgentRosterEntry | null>(null);

// ADD:
const router = useRouter();
```

4. Update PrimaryCard onClick:
```typescript
// BEFORE:
<PrimaryCard agent={primaryOperator} onClick={() => setSelectedAgent(primaryOperator)} />

// AFTER:
<PrimaryCard agent={primaryOperator} onClick={() => router.push(`/team/${primaryOperator.id}`)} />
```

5. Update AgentCard onClick:
```typescript
// BEFORE:
<AgentCard key={agent.id} agent={agent} onClick={() => setSelectedAgent(agent)} />

// AFTER:
<AgentCard key={agent.id} agent={agent} onClick={() => router.push(`/team/${agent.id}`)} />
```

6. Remove the `AgentDetailSheet` at the bottom of the JSX:
```typescript
// REMOVE these lines:
<AgentDetailSheet
  agent={selectedAgent}
  open={!!selectedAgent}
  onOpenChange={(open) => !open && setSelectedAgent(null)}
/>
```

7. Remove `useState` from the React import if no longer used:
```typescript
// BEFORE:
import { useState, useEffect } from "react";
// AFTER:
import { useEffect } from "react";
```

8. Remove the `AgentRosterEntry` type import if no longer used by the page (check — it's used in `AgentCard` and `PrimaryCard` props but those are defined inline in the same file, so the type IS still used).

9. Delete `apps/dashboard/src/components/team/agent-detail-sheet.tsx` — it is fully replaced by the config page. No other file imports it (the team page was the only consumer).

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @switchboard/dashboard typecheck`
Expected: No errors

- [ ] **Step 3: Verify the app builds**

Run: `pnpm --filter @switchboard/dashboard build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```
git commit -m "feat: replace agent detail sheet with config page navigation"
```

---

### Task 8: Full Test Suite

**Files:**
- Test: `apps/dashboard/src/components/team/__tests__/agent-behavior-options.test.ts` (already created in Task 1)
- Test: `apps/dashboard/src/components/team/__tests__/agent-preview-templates.test.ts` (already created in Task 2)

- [ ] **Step 1: Run all dashboard tests**

Run: `pnpm --filter @switchboard/dashboard test`
Expected: All tests PASS

- [ ] **Step 2: Run typecheck across the monorepo**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 4: Final commit if any fixes needed**

```
git commit -m "test: verify agent config page integration"
```
