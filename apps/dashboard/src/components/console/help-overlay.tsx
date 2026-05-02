"use client";

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" role="presentation" onClick={onClose}>
      <div
        className="help-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-overlay-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="head-row">
          <h2 id="help-overlay-title">How Switchboard works</h2>
          <button type="button" className="close" onClick={onClose}>
            Close ✕
          </button>
        </div>
        <p>
          Three agents work on your behalf around the clock. <b>Alex</b> handles inbound
          conversations, <b>Nova</b> manages ad spend, and <b>Mira</b> develops creative. They act
          on their own — and stop to ask only when judgment is needed.
        </p>
        <p>
          The <b>Queue</b> at the top is the only thing that needs you. The <b>Agent strip</b> below
          it shows what each one is doing right now. The <b>Activity trail</b> at the bottom is the
          running record.
        </p>
        <div className="keys">
          <kbd>?</kbd>
          <span>Open this help</span>
          <kbd>1 / 2 / 3</kbd>
          <span>Open Alex / Nova / Mira panel</span>
          <kbd>H</kbd>
          <span>Halt or resume all agents</span>
          <kbd>Esc</kbd>
          <span>Close panels & overlays</span>
        </div>
      </div>
    </div>
  );
}
