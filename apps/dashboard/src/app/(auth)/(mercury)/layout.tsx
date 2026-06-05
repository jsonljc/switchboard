/**
 * Mercury register marker (TY4). The body-face rule in globals.css excludes
 * any route that renders [data-register="mercury"], so every Mercury route
 * keeps the legacy Inter body face end to end (page content AND portals).
 * A hidden SIBLING, not a wrapper: zero layout impact, no new ancestor for
 * Mercury selectors, and :has() matches hidden elements. Server-rendered so
 * the exclusion holds on first paint. Guard-paired with the CSS rule in
 * token-governance.test.ts (the exclusion is inert without this producer).
 */
export default function MercuryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div data-register="mercury" hidden />
      {children}
    </>
  );
}
