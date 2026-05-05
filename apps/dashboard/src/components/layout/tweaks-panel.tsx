"use client";

export function TweaksPanel({ hasTweaksFlag }: { hasTweaksFlag: boolean }) {
  if (process.env.NEXT_PUBLIC_DEPLOY_ENV === "production") return null;
  if (!hasTweaksFlag) return null;
  return (
    <aside role="complementary" className="tp-panel" aria-label="Design tweaks">
      <p>Tweaks panel (preview only)</p>
    </aside>
  );
}
