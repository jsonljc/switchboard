export function PortraitRiley() {
  return (
    <svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <radialGradient id="riley-pg" cx=".5" cy=".42" r=".72">
          <stop offset="0%" stopColor="hsl(28 38% 88%)" />
          <stop offset="55%" stopColor="hsl(15 35% 78%)" />
          <stop offset="100%" stopColor="hsl(15 30% 60%)" />
        </radialGradient>
        <clipPath id="riley-pc">
          <circle cx="70" cy="70" r="70" />
        </clipPath>
      </defs>
      <g clipPath="url(#riley-pc)">
        <rect width="140" height="140" fill="url(#riley-pg)" />
        <path
          d="M 8 140 L 8 116 Q 8 92 70 92 Q 132 92 132 116 L 132 140 Z"
          fill="hsl(15 22% 30%)"
          opacity=".85"
        />
        <rect x="60" y="78" width="20" height="22" rx="3" fill="hsl(18 22% 54%)" />
        <ellipse cx="70" cy="58" rx="26" ry="30" fill="hsl(18 26% 62%)" />
        <path
          d="M 44 60 Q 44 32 70 30 Q 96 32 96 60 Q 96 50 88 46 Q 78 52 70 48 Q 60 52 52 46 Q 44 50 44 60 Z"
          fill="hsl(15 18% 22%)"
        />
        <ellipse cx="82" cy="56" rx="6" ry="10" fill="hsl(30 50% 92%)" opacity=".22" />
        <path
          d="M 64 72 Q 70 75 76 72"
          stroke="hsl(15 18% 22%)"
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
