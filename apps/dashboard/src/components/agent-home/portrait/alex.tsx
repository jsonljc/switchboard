export function PortraitAlex() {
  return (
    <svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="alex-pg" cx=".55" cy=".4" r=".75">
          <stop offset="0%" stopColor="hsl(40 35% 88%)" />
          <stop offset="60%" stopColor="hsl(28 28% 80%)" />
          <stop offset="100%" stopColor="hsl(22 22% 66%)" />
        </radialGradient>
        <clipPath id="alex-pc">
          <circle cx="70" cy="70" r="70" />
        </clipPath>
      </defs>
      <g clipPath="url(#alex-pc)">
        <rect width="140" height="140" fill="url(#alex-pg)" />
        <path
          d="M 8 140 L 8 116 Q 8 92 70 92 Q 132 92 132 116 L 132 140 Z"
          fill="hsl(20 14% 32%)"
          opacity=".85"
        />
        <rect x="60" y="78" width="20" height="22" rx="3" fill="hsl(22 18% 56%)" />
        <ellipse cx="70" cy="58" rx="26" ry="30" fill="hsl(22 22% 64%)" />
        <path
          d="M 44 56 Q 44 30 70 28 Q 96 30 96 56 Q 96 48 88 44 Q 80 48 70 46 Q 58 48 52 44 Q 44 48 44 56 Z"
          fill="hsl(20 14% 24%)"
        />
        <ellipse cx="82" cy="56" rx="6" ry="10" fill="hsl(40 50% 92%)" opacity=".25" />
        <path
          d="M 64 72 Q 70 76 76 72"
          stroke="hsl(20 14% 24%)"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          opacity=".5"
        />
      </g>
      <circle cx="70" cy="70" r="69.5" fill="none" stroke="hsl(20 10% 12% / .14)" />
    </svg>
  );
}
