import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Switchboard — Component preview",
  robots: { index: false, follow: false },
};

/**
 * Preview route group. Intentionally minimal chrome so design
 * components render against a clean canvas. NOT a production surface.
 * Pages under this group are deleted as the surfaces they preview ship.
 */
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--cream)",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {children}
    </div>
  );
}
