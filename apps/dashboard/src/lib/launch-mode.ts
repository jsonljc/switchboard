export function getCtaHref(): string {
  const mode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  return mode === "beta" ? "/signup" : "/get-started";
}

export function getCtaLabel(): string {
  const mode = process.env.NEXT_PUBLIC_LAUNCH_MODE || "waitlist";
  return mode === "beta" ? "Start free beta" : "Get early access";
}
