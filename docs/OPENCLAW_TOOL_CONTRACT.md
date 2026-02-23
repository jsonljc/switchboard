# OpenClaw Tool Contract: switchboard_execute

This document defines the contract for the **switchboard_execute** tool so an [OpenClaw](https://github.com/openclaw/openclaw) skill or agent can call Switchboard for governed execution. One tool call → one deterministic outcome (EXECUTED | PENDING_APPROVAL | DENIED).

---

## Tool name

`switchboard_execute`

---

## Input (tool arguments)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `actorId` | string | Yes | Principal performing the action (e.g. user id from OpenClaw context). |
| `organizationId` | string \| null | No | Organization scope for governance profile and audit. |
| `action` | object | Yes | The action to execute. |
| `action.actionType` | string | Yes | e.g. `ads.campaign.pause`, `ads.budget.adjust`. |
| `action.parameters` | record | Yes | Action parameters (e.g. `{ campaignId: "123" }`). |
| `action.sideEffect` | boolean | Yes | Must be `true` for real execution. |
| `action.magnitude` | object | No | Optional `currencyDelta`, `countDelta` for risk. |
| `entityRefs` | array | No | `[{ inputRef, entityType }]` for entity resolution. |
| `message` | string | No | Evidence or context for audit. |
| `traceId` | string | No | Correlation id (e.g. from OpenClaw request). |

**Example**

```json
{
  "actorId": "user_abc",
  "organizationId": "org_1",
  "action": {
    "actionType": "ads.campaign.pause",
    "parameters": { "campaignId": "camp_123" },
    "sideEffect": true
  },
  "traceId": "oc_req_xyz"
}
```

---

## Output (tool result)

| Field | Type | When present |
|-------|------|--------------|
| `outcome` | `"EXECUTED"` \| `"PENDING_APPROVAL"` \| `"DENIED"` | Always |
| `envelopeId` | string | Always |
| `traceId` | string | Always |
| `summary` | string | Human-readable summary for the agent to relay. |
| `approvalUrl` | string | When `outcome === "PENDING_APPROVAL"` — URL to approve/reject (API or dashboard). |
| `approvalId` | string | When PENDING_APPROVAL. |
| `approvalRequest` | object | When PENDING_APPROVAL — summary, riskCategory, bindingHash, expiresAt. |
| `executionResult` | object | When EXECUTED — success, summary, externalRefs, rollbackAvailable, etc. |
| `deniedExplanation` | string | When DENIED. |
| `error` | string | When needsClarification or notFound (422/404 from API). |

**Example (EXECUTED)**

```json
{
  "outcome": "EXECUTED",
  "envelopeId": "env_...",
  "traceId": "trace_...",
  "summary": "Campaign camp_123 paused.",
  "executionResult": {
    "success": true,
    "summary": "Campaign camp_123 paused.",
    "rollbackAvailable": true
  }
}
```

**Example (PENDING_APPROVAL)**

```json
{
  "outcome": "PENDING_APPROVAL",
  "envelopeId": "env_...",
  "traceId": "trace_...",
  "summary": "Approval required. Use approvalUrl to approve or reject.",
  "approvalUrl": "https://api.switchboard.example.com/api/approvals/appr_...",
  "approvalId": "appr_...",
  "approvalRequest": {
    "id": "appr_...",
    "summary": "Pause campaign camp_123",
    "riskCategory": "medium",
    "bindingHash": "...",
    "expiresAt": "2025-02-24T12:00:00.000Z"
  }
}
```

**Example (DENIED)**

```json
{
  "outcome": "DENIED",
  "envelopeId": "env_...",
  "traceId": "trace_...",
  "summary": "Action was denied by policy or risk.",
  "deniedExplanation": "Action type \"ads.campaign.pause\" is forbidden for this principal."
}
```

---

## Approval flow (when outcome is PENDING_APPROVAL)

1. **Present to user**  
   The agent should show the user that approval is required and provide:
   - `summary` and `approvalRequest.summary`
   - `approvalUrl` (link to dashboard or API), or instructions to approve via CLI/UI.

2. **Poll status (optional)**  
   - `GET {baseUrl}/api/approvals/{approvalId}`  
   - Response includes `request`, `state` (status), `envelopeId`.  
   - When `state.status` is `approved` or `rejected`, stop polling.

3. **Respond to approval**  
   - To approve: `POST {baseUrl}/api/approvals/{approvalId}/respond`  
     Body: `{ "action": "approve", "respondedBy": "<principalId>", "bindingHash": "<from approvalRequest>" }`  
   - To reject: same with `"action": "reject"`.  
   - After approve, Switchboard executes automatically; no separate “execute” call needed.

4. **Resume (optional)**  
   If the agent needs to show the execution result after approval, it can:
   - Poll `GET {baseUrl}/api/actions/{envelopeId}` until `status` is `executed` or `failed`, or  
   - Rely on webhooks/notifications if configured.

---

## HTTP equivalent

The tool is implemented by calling **POST /api/execute** with the same input shape. Requirements:

- **Idempotency-Key** header is required (replay protection).
- **Authorization: Bearer &lt;api_key&gt;** when API_KEYS is configured.

So an OpenClaw skill can either:

- Use the **Switchboard OpenClaw adapter** (in-process or via a small proxy) that maps tool payload → `RuntimeExecuteRequest` → ExecutionService or HTTP → `OpenClawToolResponse`, or  
- Call **POST /api/execute** directly and map the JSON response to the tool result (add `approvalUrl` as `{baseUrl}/api/approvals/{approvalId}` when outcome is PENDING_APPROVAL).

---

## Chat API mode (single choke point)

When the **Switchboard Chat** app is configured to use the API instead of an in-process orchestrator, all propose/execute/approval/undo flows go through the HTTP API (single choke point).

- Set **`SWITCHBOARD_API_URL`** to the Switchboard API base (e.g. `https://api.switchboard.example.com`).
- Optionally set **`SWITCHBOARD_API_KEY`** for `Authorization: Bearer` when the API requires it.

The Chat runtime then uses an **API orchestrator adapter** that:

- **Propose + conditional execute:** `resolveAndPropose` → `POST /api/execute` (Idempotency-Key per request). Response EXECUTED / PENDING_APPROVAL / DENIED is mapped back to the same shape the in-process orchestrator would return.
- **Execute (auto-approved path):** When the execute response was EXECUTED, the adapter caches the execution result and returns it when Chat calls `executeApproved(envelopeId)` (no second network call).
- **Approval response:** `respondToApproval` → `POST /api/approvals/:id/respond`.
- **Undo:** `requestUndo` → `POST /api/actions/:id/undo`.

No code path in Chat bypasses the API when `SWITCHBOARD_API_URL` is set.

---

## References

- Switchboard API: `POST /api/execute`, `GET /api/approvals/:id`, `POST /api/approvals/:id/respond`
- Adapter types: `@switchboard/core` — `OpenClawToolPayload`, `OpenClawToolResponse`, `openclawExecute`, `HttpExecutionAdapter`
- [OpenClaw](https://github.com/openclaw/openclaw) — skills and tools
