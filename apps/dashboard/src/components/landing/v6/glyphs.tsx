// Shared SVG defs for the v6 landing page. Placed once at the top of the page
// so all <use href="#mark-alex"/> etc. resolve.
export function V6Glyphs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="arrow-sig" viewBox="0 0 22 14">
          <path d="M0.8 7 C 5 7, 7 10.5, 11 9.2 C 14 8.2, 15 5, 19.2 5 M14.6 1.6 L19.6 5 L15.4 8.6" />
        </symbol>

        <symbol id="check" viewBox="0 0 14 10">
          <path
            d="M1 5.2 L4.6 8.6 L13 1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>

        {/* ALEX glyph: speech bubble with pulse — the listener */}
        <symbol id="mark-alex" viewBox="0 0 48 48">
          <path
            d="M 8 14 Q 8 8, 14 8 L 34 8 Q 40 8, 40 14 L 40 28 Q 40 34, 34 34 L 22 34 L 14 41 L 14 34 Q 8 34, 8 28 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="21" r="2.2" fill="currentColor" />
          <circle
            cx="24"
            cy="21"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity=".4"
          />
        </symbol>

        {/* NOVA glyph: scope/signal — the watcher */}
        <symbol id="mark-nova" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle
            cx="24"
            cy="24"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity=".5"
          />
          <line
            x1="24"
            y1="4"
            x2="24"
            y2="11"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <line
            x1="24"
            y1="37"
            x2="24"
            y2="44"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <line
            x1="4"
            y1="24"
            x2="11"
            y2="24"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <line
            x1="37"
            y1="24"
            x2="44"
            y2="24"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="24" cy="24" r="2.2" fill="currentColor" />
        </symbol>

        {/* MIRA glyph: aperture — the maker */}
        <symbol id="mark-mira" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <g stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round">
            <path d="M 24 9  L 33 18 L 24 18 Z" />
            <path d="M 39 24 L 30 33 L 30 24 Z" />
            <path d="M 24 39 L 15 30 L 24 30 Z" />
            <path d="M 9  24 L 18 15 L 18 24 Z" />
          </g>
          <circle cx="24" cy="24" r="3" fill="currentColor" />
        </symbol>
      </defs>
    </svg>
  );
}

// Reusable stroked-arrow icon used inside CTAs.
export function ArrowSig({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`inline-block fill-none stroke-current ${className}`}
      style={{
        width: "1em",
        height: "0.66em",
        verticalAlign: "-0.05em",
        strokeWidth: 1.6,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      }}
      aria-hidden="true"
    >
      <use href="#arrow-sig" />
    </svg>
  );
}
