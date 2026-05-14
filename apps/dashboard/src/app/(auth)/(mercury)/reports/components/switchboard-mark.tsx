export function SwitchboardMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill="#0E0C0A" />
      <circle cx="7" cy="11" r="1.6" fill="#fff" />
      <circle cx="15" cy="11" r="1.6" fill="#fff" />
      <path
        d="M 7 11 Q 11 6.5, 15 11"
        stroke="hsl(30 55% 46%)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
