# OpenClaw Allow/Deny Configuration

This document describes how to control **which actions OpenClaw (or any runtime) can request** and **under what conditions** they are allowed, denied, or require approval. No new engine is required — use **identity**, **policies**, and **Governance Profile** only.

---

## 1. Identity (principal-level allow/deny)

Each request to Switchboard is made with an **actorId** (principal). That principal has an **identity spec** that defines:

- **Forbidden behaviors**  
  Action types in this list are **always denied** (e.g. `["ads.budget.adjust"]` to block budget changes for this principal).

- **Trust behaviors**  
  Action types in this list are **auto-allowed** (no approval gate) when policy and risk would otherwise allow. Use for low-risk or highly trusted actions (e.g. `["ads.campaign.pause"]` for a power user).

- **Risk tolerance**  
  Maps risk category (none/low/medium/high/critical) to approval requirement: `none`, `standard`, `elevated`, `mandatory`. Tighter tolerance → more actions require approval.

- **Delegated approvers**  
  Who can approve on behalf of this principal when approval is required.

- **Spend limits**  
  Per-action or daily/weekly limits; exceeding them causes deny.

**Use case (OpenClaw):**  
- Restrict OpenClaw’s principal to a **limited allowlist**: create an identity spec for the OpenClaw bot principal with `forbiddenBehaviors` listing every action type you do *not* want it to perform (e.g. only allow `ads.campaign.pause`, `ads.campaign.resume`; forbid `ads.budget.adjust`).  
- Or use **trustBehaviors** only for the few actions the bot is allowed to do without approval, and leave the rest to policy/risk.

**Where:** Identity specs and overlays are managed via **POST/GET/PUT /api/identity/specs** and **/api/identity/overlays**. Configure the principal that OpenClaw uses (e.g. `actorId` from your OpenClaw skill config).

---

## 2. Policies (Policy-as-Code)

Policies are **deterministic rules** (conditions + effect). Effects include:

- **allow** — Allow the action (subject to risk/approval from identity).
- **deny** — Deny the action.
- **require_approval** — Force an approval step (with optional `approvalRequirement` and `riskCategoryOverride`).

Policies can filter by **cartridgeId**, and conditions can use **actionType**, **parameters**, **riskCategory**, **organizationId**, etc.

**Use case (OpenClaw):**  
- **Deny by action type:** Add a policy that matches `actionType` = `ads.budget.adjust` and effect **deny** for the cartridge.  
- **Require approval for high impact:** Add a policy that matches e.g. `parameters.budgetChange` &gt; 1000 and effect **require_approval** so large budget changes always go to a human.  
- **Org-specific:** Use `organizationId` in conditions so only certain orgs can trigger certain actions.

**Where:** **GET/POST/PUT /api/policies**. No new engine — only configure policies; the existing policy engine evaluates them before execution.

---

## 3. Governance Profile (per-org “dial”)

**Governance profiles** (Observe / Guarded / Strict / Locked) map to **system risk posture** (normal / elevated / critical). They are configured **per organization** (or global):

- **Observe** — Normal posture; identity and policies decide.
- **Guarded** — Normal; default for most orgs.
- **Strict** — Elevated posture; more actions require approval.
- **Locked** — Critical posture; mandatory approval or deny for sensitive actions.

So for **SMB** you might set profile **Guarded**; for **MNC** or high-risk orgs set **Strict** or **Locked**. The same policy and identity rules apply; only the “dial” of how strict the system is changes.

**Use case (OpenClaw):**  
- Set the **organizationId** that OpenClaw sends (e.g. from workspace or tenant) and assign that org a **Strict** or **Locked** profile so all OpenClaw-originated requests are treated with higher scrutiny.  
- No new engine — profile is stored (e.g. in `GovernanceProfileStore`) and mapped to posture in the existing pipeline.

**Where:** Governance profile is read from **GovernanceProfileStore** in the orchestrator (keyed by `organizationId`). Configure the store (e.g. in-memory or future API) with the desired profile per org.

---

## 4. Summary table

| Mechanism | What it does | Where to configure |
|-----------|----------------|---------------------|
| **Identity: forbiddenBehaviors** | Deny specific action types for a principal | Identity spec for OpenClaw’s actorId |
| **Identity: trustBehaviors** | Auto-allow (no approval) for specific action types | Identity spec |
| **Identity: riskTolerance** | When approval is required by risk category | Identity spec |
| **Policies: deny** | Deny when conditions match (actionType, params, org, etc.) | POST /api/policies |
| **Policies: require_approval** | Force approval when conditions match | POST /api/policies |
| **Governance Profile** | Per-org posture (Strict/Locked → more approvals) | GovernanceProfileStore per organizationId |

---

## 5. Recommended pattern for OpenClaw

1. **Single principal** for the OpenClaw integration (e.g. `openclaw_bot` or the user id the agent acts for).  
2. **Identity spec** for that principal: set **forbiddenBehaviors** to everything you do *not* want OpenClaw to do; or allow only a small set and leave the rest denied by default.  
3. **Policies** to deny or require_approval for specific patterns (e.g. budget change above $X, or certain campaigns).  
4. **Governance profile** for the org(s) OpenClaw acts in: e.g. **Guarded** for internal, **Strict** for production.

No new engine or code paths — only configuration of identity, policies, and governance profile.
