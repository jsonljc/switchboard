/* /approvals — detail panel (right pane).
   Order: Header → Binding Hash card → Approvers → Action drawer. */
const { useState: useStateD, useEffect: useEffectD, useMemo: useMemoD, useRef: useRefD } = React;

function shortHash(h){ if (!h) return ""; return h.slice(0, 10) + "…" + h.slice(-4) }

/* Short, copy-friendly value render for parametersSnapshot */
function renderValue(v){
  if (v === null || v === undefined) return <em>null</em>;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return v.toLocaleString();
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* ---------- Block 2: binding hash card (cannot hide) ---------- */
function HashCard({ req }){
  const [copied, setCopied] = useStateD(false);
  function copy(){
    try { navigator.clipboard.writeText(req.bindingHash); } catch(e){}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="hash-card">
      <div className="hash-card-head">
        <span className="eyebrow">Integrity check &middot; binding hash</span>
        <span className="hash-card-head-right">sha256 &middot; 32 hex &middot; envelope-scoped</span>
      </div>
      <div className="hash-row">
        <span className="hash-value">{req.bindingHash}</span>
        <button className={"hash-copy" + (copied ? " copied" : "")} onClick={copy}>
          {copied ? "copied" : "copy hash"}
        </button>
      </div>
      <div className="hash-foot">
        <span className="eyebrow">envelope</span>
        <span className="env">{req.envelopeId}</span>
        <span className="sep">&middot;</span>
        <span>signed by <b style={{color:"var(--ink-2)",fontWeight:600}}>switchboard-prod</b></span>
        <span className="sep">&middot;</span>
        <span>signing this hash binds <b style={{color:"var(--ink-2)",fontWeight:600}}>only</b> the parameters shown above</span>
      </div>
    </div>
  );
}

/* ---------- Block 3: approvers / quorum ---------- */
function Approvers({ req, currentUser, hasSigned }){
  const required = (req.request && req.request.approvalsRequired) || 1;
  const list = (req.request && req.request.approvers) || [currentUser.id];
  const signedHashes = (req.state && req.state.approvalHashes) || [];

  // Single-approver case → don't render this block (it's noise).
  if (required <= 1 && list.length <= 1) return null;

  const remaining = Math.max(0, required - signedHashes.length - (hasSigned ? 1 : 0));

  // Map non-operator approvers in list order onto signedHashes by index.
  const nonYou = list.filter(a => a !== currentUser.id);

  return (
    <div className="dblock">
      <div className="approvers">
        <div className="approvers-head">
          <span className="eyebrow">quorum · approvers</span>
          <span className="qcount">{signedHashes.length + (hasSigned ? 1 : 0)} of {required} signed</span>
        </div>
        <div className="approvers-list">
          {list.map((id, idx) => {
            const isYou = id === currentUser.id;
            const nonYouIdx = nonYou.indexOf(id);
            const signed = isYou ? hasSigned : (nonYouIdx >= 0 && nonYouIdx < signedHashes.length);
            const stampHash = signed && !isYou ? signedHashes[nonYouIdx] : null;
            return (
              <div key={id} className={"approver" + (isYou ? " you" : "") + (signed ? " signed" : "")}>
                <span className="approver-mark">{signed ? "✓" : (idx + 1)}</span>
                <span className="approver-name">
                  {isYou ? "Operator" : id}
                  {isYou && <b>{signed ? "signed" : "you"}</b>}
                </span>
                <span className="approver-stamp">
                  {signed
                    ? (isYou
                        ? <span className="signed-hash">just now</span>
                        : <span className="signed-hash">{stampHash}</span>)
                    : <span className="waiting">awaiting</span>}
                </span>
              </div>
            );
          })}
        </div>
        <div className="approvers-head">
          <span />
          <span className="qhint">
            {remaining === 0
              ? "Quorum will be complete on your signature."
              : `${remaining} more required after you sign.`}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Header block ---------- */
function Header({ req, now }){
  const remaining = req.expiresAt - now;
  const tlevel = window.timerLevel(remaining);
  return (
    <div className="dblock">
      <div className="detail-head">
        <div className="dh-row">
          <span className="dh-pill" data-risk={req.riskCategory}>
            <span className="dot" />
            <span>{req.riskCategory}</span>
          </span>
          <span className="dh-id">
            <span style={{color:"var(--sw-text-muted)"}}>id</span> <b>{req.id}</b>
          </span>
          <span className="dh-spacer" />
          <span className={"dh-timer " + tlevel}>
            <span className="eyebrow-inline">{remaining <= 0 ? "expired" : "expires in"}</span>
            <span>{remaining <= 0
              ? window.fmtAgo(-remaining) + " ago"
              : window.fmtRemaining(remaining)}</span>
          </span>
        </div>

        <h1 className="dh-summary">{req.summary}</h1>

        <div className="dh-foot">
          <span><span className="eyebrow" style={{marginRight:6}}>agent</span><b>{req.agent}</b></span>
          <span className="sep">·</span>
          <span><span className="eyebrow" style={{marginRight:6}}>requested by</span><b>{req.requestedBy}</b></span>
          <span className="sep">·</span>
          <span><span className="eyebrow" style={{marginRight:6}}>action</span><b>{req.request.action}</b></span>
          <span className="sep">·</span>
          <span><span className="eyebrow" style={{marginRight:6}}>created</span>{window.fmtAgo(now - req.createdAt)}</span>
        </div>

        <div className="params">
          <div className="params-head">
            <span className="eyebrow">parameters snapshot</span>
            <span style={{fontFamily:"var(--font-mono)",fontSize:"11px",color:"var(--ink-4)",letterSpacing:"0.02em"}}>
              frozen at request &middot; revision 1
            </span>
          </div>
          <dl>
            {Object.entries(req.request.parametersSnapshot).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>{k}</dt>
                <dd>{renderValue(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

/* ---------- Recovery banner ---------- */
function RecoveryBanner({ req, now }){
  if (req.status !== "recovery_required") return null;
  const r = req.recovery || {};
  return (
    <div className="recovery-banner">
      <span className="eyebrow">recovery required</span>
      <div className="rb-msg">{r.reason}</div>
      <div className="rb-foot">
        <span className="eyebrow" style={{color:"inherit"}}>proposed fix</span>
        <b>{r.proposedFix}</b>
        {r.lastAttemptAt && (
          <>
            <span className="sep">·</span>
            <span>last attempt {window.fmtAgo(now - r.lastAttemptAt)}</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Patch editor with side-by-side diff ---------- */
function PatchEditor({ req, onCancel, onSubmit }){
  const snapshot = req.request.parametersSnapshot;
  const seed = (req.patchProposal && req.patchProposal.diff) || {};
  // editor holds JSON text — proposed parameters (after patch)
  const initialMerged = useMemoD(() => ({ ...snapshot, ...seed }), [snapshot, seed]);
  const [text, setText] = useStateD(() => JSON.stringify(initialMerged, null, 2));
  const [parsed, setParsed] = useStateD(initialMerged);
  const [error, setError] = useStateD(null);

  function onChange(e){
    const next = e.target.value;
    setText(next);
    try {
      const obj = JSON.parse(next);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        setParsed(obj); setError(null);
      } else {
        setError("Patch must be a JSON object.");
      }
    } catch(err){
      setError(err.message.replace(/^JSON\.parse: /, ""));
    }
  }

  // size budget (per spec: ≤ 100 KB)
  const bytes = new Blob([text]).size;
  const sizePct = Math.min(1, bytes / (100 * 1024));

  // diffs vs snapshot
  const allKeys = Array.from(new Set([...Object.keys(snapshot), ...Object.keys(parsed || {})]));
  const diffKeys = allKeys.filter(k => JSON.stringify(snapshot[k]) !== JSON.stringify((parsed || {})[k]));

  function renderSnapshotPretty(obj){
    return Object.keys(obj).map(k => {
      const v = obj[k];
      const changed = diffKeys.includes(k);
      const str = typeof v === "string" ? `"${v}"` : (typeof v === "object" ? JSON.stringify(v) : String(v));
      return (
        <div key={k}>
          <span className="key">{`  "${k}": `}</span>
          <span className={changed ? "removed" : ""}>{str}</span>
          <span className="key">,</span>
        </div>
      );
    });
  }

  return (
    <div className="patch-editor">
      <div className="pe-head">
        <span className="eyebrow">patch parameters · diff</span>
        <span className="hint">applies patchValue → re-signs binding hash → approves modified revision</span>
      </div>

      <div className="pe-diff">
        <div className="pe-pane">
          <span className="pe-pane-label">current · parametersSnapshot</span>
          <pre className="pe-snapshot">
            {"{"}
            {renderSnapshotPretty(snapshot)}
            {"}"}
          </pre>
        </div>
        <div className="pe-pane">
          <span className="pe-pane-label proposed">proposed · patchValue</span>
          <textarea
            className={"pe-editor" + (error ? " invalid" : "")}
            value={text}
            onChange={onChange}
            spellCheck="false"
          />
          {error && <span className="pe-error">{error}</span>}
        </div>
      </div>

      <div className="pe-foot">
        <div className="pe-foot-left">
          <span className="eyebrow">size</span> <b>{(bytes / 1024).toFixed(2)} KB</b> of 100 KB
          {diffKeys.length > 0 && (
            <>
              <span style={{margin:"0 8px",opacity:.5}}>·</span>
              <span className="eyebrow">changed</span> <b>{diffKeys.join(", ")}</b>
            </>
          )}
        </div>
        <div className="pe-foot-right">
          <button className="btn-sm" onClick={onCancel}>Cancel</button>
          <button
            className="btn-sm primary"
            disabled={!!error || diffKeys.length === 0 || sizePct > 1}
            onClick={() => onSubmit(parsed)}
          >Apply patch &amp; approve</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Reject dialog ---------- */
function RejectDialog({ onCancel, onSubmit }){
  const [reason, setReason] = useStateD("");
  return (
    <div className="reject-dialog">
      <div className="pe-head">
        <span className="eyebrow">reject · optional reason</span>
        <span className="hint">no hash echo required. recorded against the lifecycle.</span>
      </div>
      <textarea
        placeholder="Why are you blocking this? (optional, but recorded)"
        value={reason}
        onChange={e => setReason(e.target.value)}
      />
      <div className="rd-foot">
        <button className="btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn-sm" onClick={() => onSubmit(reason)} style={{color:"var(--sw-text-primary)",borderColor:"var(--sw-text-primary)"}}>
          Reject
        </button>
      </div>
    </div>
  );
}

/* ---------- Action drawer (Block 4) ---------- */
function ActionDrawer({ req, currentUser, onRespond, response, now }){
  const [mode, setMode] = useStateD("idle");      // "idle" | "patch" | "reject"
  const [acked, setAcked] = useStateD(false);
  const [patchValue, setPatchValue] = useStateD(null);

  const expired = now >= req.expiresAt;
  const recovery = req.status === "recovery_required";
  const responded = !!response;

  // Quorum bookkeeping
  const required = (req.request && req.request.approvalsRequired) || 1;
  const signedAlready = (req.state && req.state.approvalHashes && req.state.approvalHashes.length) || 0;

  // Reset on req change
  useEffectD(() => { setMode("idle"); setAcked(false); setPatchValue(null); }, [req.id]);

  // Read-only short-circuits
  if (responded) {
    return (
      <div className="actions">
        <div className="actions-head"><span className="eyebrow">Decision recorded</span></div>
        <div className="actions-readonly">
          <span className={"stamp" + (response.type === "approve" ? "" : "")}>
            {response.type === "approve" ? "approved" : (response.type === "patch" ? "patched & approved" : "rejected")}
          </span>
          <span>by <b style={{color:"var(--sw-text-primary)"}}>{currentUser.display}</b> · {window.fmtAgo(now - response.at)}</span>
          {response.type === "reject" && response.reason && (
            <span style={{marginLeft:"auto",fontFamily:"var(--font-sans)",color:"var(--sw-text-secondary)",fontStyle:"italic"}}>
              "{response.reason}"
            </span>
          )}
        </div>
      </div>
    );
  }
  if (expired) {
    return (
      <div className="actions">
        <div className="actions-head"><span className="eyebrow">Window closed</span></div>
        <div className="actions-readonly">
          <span className="stamp expired">expired</span>
          <span>{window.fmtAgo(now - req.expiresAt)} ago · no action available · agent must re-propose</span>
        </div>
      </div>
    );
  }
  if (recovery) {
    return (
      <div className="actions">
        <div className="actions-head"><span className="eyebrow">Action drawer &middot; blocked</span></div>
        <div className="actions-readonly">
          <span className="stamp" style={{color:"var(--sw-text-primary)",borderColor:"var(--sw-text-primary)"}}>blocked</span>
          <span>Approval cannot proceed until upstream recovery completes. Trigger re-run from the lifecycle, then return here for a fresh hash.</span>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <button className="btn-sm" style={{color:"var(--sw-text-primary)",borderColor:"var(--sw-text-primary)"}} onClick={() => onRespond({ type: "reject", reason: "operator declined recovery flow", at: Date.now() })}>
            Reject lifecycle
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {mode === "idle" && (
        <div className="actions">
          <div className="actions-head">
            <span className="eyebrow">Action drawer</span>
            <span className="meta">
              one decision &middot; <b>{window.fmtRemaining(req.expiresAt - now)}</b> until the window closes
            </span>
          </div>

          <div className="action-stack">
            {/* APPROVE (primary, with inline hash commit) */}
            <div className="approve-commit">
              <div className="approve-commit-left">
                <span className="approve-commit-line">
                  I confirm hash
                  <span className="ic">{shortHash(req.bindingHash)}</span>
                  and authorize <span className="actv">{req.request.action}</span>.
                </span>
                <span className="approve-commit-sub">
                  {required > 1
                    ? `signing adds your envelope hash to the quorum (${signedAlready + 1} of ${required} after signing)`
                    : "signing dispatches the action immediately"}
                </span>
                <div className="confirm-ack">
                  <input id="ack" type="checkbox" checked={acked} onChange={e => setAcked(e.target.checked)} />
                  <label htmlFor="ack">
                    I have read the parameters and the hash <span className="ch">{shortHash(req.bindingHash)}</span> matches what I intend to approve.
                  </label>
                </div>
              </div>
              <button
                className="btn-approve"
                disabled={!acked}
                onClick={() => onRespond({ type: "approve", bindingHash: req.bindingHash, at: Date.now() })}
              >
                <span className="ba-label">
                  <span className="ba-title">Approve &amp; sign</span>
                  <span className="ba-hash">{shortHash(req.bindingHash)}</span>
                </span>
              </button>
            </div>

            {/* PATCH (first-class, second priority) */}
            <div className="patch-row">
              <div className="patch-row-text">
                <span className="patch-row-title">Modify parameters before approving</span>
                <span className="patch-row-sub">opens a JSON editor · diff against parametersSnapshot · ≤ 100 KB</span>
              </div>
              <button className="btn-patch" onClick={() => setMode("patch")}>Patch &amp; approve →</button>
            </div>

            {/* REJECT (quiet) */}
            <div className="reject-row">
              <span className="reject-row-text">Don't proceed with this action.</span>
              <button className="btn-reject" onClick={() => setMode("reject")}>Reject</button>
            </div>
          </div>
        </div>
      )}

      {mode === "patch" && (
        <div className="actions">
          <div className="actions-head">
            <span className="eyebrow">patch &amp; approve</span>
            <button className="btn-sm" onClick={() => setMode("idle")} style={{borderColor:"transparent"}}>← back</button>
          </div>
          <PatchEditor
            req={req}
            onCancel={() => setMode("idle")}
            onSubmit={(value) => onRespond({ type: "patch", patchValue: value, bindingHash: req.bindingHash, at: Date.now() })}
          />
        </div>
      )}

      {mode === "reject" && (
        <div className="actions">
          <div className="actions-head">
            <span className="eyebrow">reject</span>
            <button className="btn-sm" onClick={() => setMode("idle")} style={{borderColor:"transparent"}}>← back</button>
          </div>
          <RejectDialog
            onCancel={() => setMode("idle")}
            onSubmit={(reason) => onRespond({ type: "reject", reason, at: Date.now() })}
          />
        </div>
      )}
    </>
  );
}

/* ---------- Dispatch banner (post-approve) ---------- */
function DispatchBanner({ response, req }){
  if (!response || response.type === "reject") return null;
  return (
    <div className="dispatch-banner">
      <span className="eyebrow">dispatch</span>
      <span className="msg">
        ExecutableWorkUnit captured against binding <span className="id">{shortHash(req.bindingHash)}</span>. Frozen for 12h; idempotency guaranteed by envelope.
      </span>
      <span className="id">wu_99102</span>
    </div>
  );
}

/* ---------- Empty / error states for detail pane ---------- */
function DetailEmpty(){
  return (
    <div className="detail">
      <div className="detail-placeholder">
        <div className="ph">
          <span className="eyebrow">select an approval</span>
          <span className="lead">Pick a row to inspect evidence and sign.</span>
          <span className="lead-sub">Each binding hash binds a specific set of parameters. Signing approves only that exact revision.</span>
        </div>
      </div>
    </div>
  );
}
function DetailError({ message, onRetry }){
  return (
    <div className="detail">
      <div className="errbanner" style={{margin:"32px 36px"}}>
        <span className="eyebrow">request failed</span>
        <span className="msg">{message}</span>
        <div><button className="btn-sm" onClick={onRetry} style={{marginTop:8}}>Retry</button></div>
      </div>
    </div>
  );
}

/* ---------- Top-level Detail ---------- */
function Detail({ req, currentUser, onRespond, response, now, error, onRetry }){
  if (error) return <DetailError message={error} onRetry={onRetry} />;
  if (!req) return <DetailEmpty />;

  // For quorum block, "you signed" reflects local response
  const hasSigned = !!(response && (response.type === "approve" || response.type === "patch"));

  return (
    <div className="detail">
      <Header req={req} now={now} />
      <HashCard req={req} />
      <Approvers req={req} currentUser={currentUser} hasSigned={hasSigned} />
      <RecoveryBanner req={req} now={now} />
      <ActionDrawer
        req={req}
        currentUser={currentUser}
        onRespond={onRespond}
        response={response}
        now={now}
      />
      {hasSigned && <DispatchBanner response={response} req={req} />}
    </div>
  );
}

window.Detail = Detail;
