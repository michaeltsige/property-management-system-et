/**
 * The product logo, drawn as vector so it stays crisp from a 24 px favicon-sized
 * mark up to the login hero. One geometry everywhere: staff app, tenant portal,
 * login screens.
 *
 * Mark: a gabled roof over walls with an arched open door — home, plainly.
 * The tile uses the brand color via `currentColor` so dark/light contexts can
 * re-tone it without a second asset.
 */
export function Logo({
  size = 40,
  tileClass = 'text-brand-700',
  className,
}: {
  size?: number;
  /** Tailwind text-color class applied to the tile (mark uses currentColor). */
  tileClass?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Logo"
      focusable="false"
    >
      <rect width="48" height="48" rx="11" className={tileClass} fill="currentColor" />
      {/* Roof */}
      <path
        d="M11 25.5 24 13l13 12.5"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Walls with an arched open door */}
      <path
        d="M15 24.5V36h6.8v-6a2.7 2.7 0 0 1 5.4 0v6H33V24.5"
        fill="none"
        stroke="#fff"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
