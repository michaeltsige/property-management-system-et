'use client';

/**
 * The product icon system — one governed component, one hand-drawn glyph set.
 *
 * Why not an icon package: off-the-shelf sets (Lucide in particular) ship the
 * same dozen silhouettes every "vibecoded" product uses, and import a dependency
 * to draw thirty straight lines. These glyphs are drawn in-house on a single
 * 24x24 grid with one stroke weight (1.75px), round caps and joins, so the whole
 * set shares one optical weight — the consistency rule in docs/REFERENCES.md.
 *
 * Rules encoded here so call sites cannot get them wrong:
 * - Icons are DECORATIVE by default (`aria-hidden`); a text label must carry the
 *   meaning. Pass `label` only when the icon is the entire content of a control,
 *   which turns it into `role="img"` with an accessible name.
 * - Size comes from the token scale (sm 16 / md 20 / lg 24) on the 4px grid;
 *   `className` can still override for one-off optical corrections.
 * - Color is always `currentColor`, so icons inherit text tokens and meet
 *   contrast in every state, including forced-colors mode.
 */

import type { ReactNode, SVGProps } from 'react';

import { cn } from '@/lib/utils';

export type IconName =
  | 'calendar'
  | 'calendar-plus'
  | 'chart'
  | 'clipboard'
  | 'close'
  | 'dashboard'
  | 'download'
  | 'building'
  | 'file'
  | 'globe'
  | 'home'
  | 'ledger'
  | 'log-out'
  | 'menu'
  | 'play'
  | 'plus'
  | 'receipt'
  | 'refresh'
  | 'save'
  | 'search'
  | 'trash'
  | 'trend-down'
  | 'trend-up'
  | 'upload'
  | 'user-plus'
  | 'users'
  | 'wallet'
  | 'wrench'
  | 'chevron-left'
  | 'chevron-right';

/** Size tokens (4px grid): dense inline / default / standalone nav. */
const SIZE_PX = { sm: 16, md: 20, lg: 24 } as const;
export type IconSize = keyof typeof SIZE_PX;

/**
 * The glyph set. Every path lives on the same 24x24 grid, stays inside the
 * ~2px-24px live area, and uses only stroke (fill for the two arrowheads and
 * the play glyph's inner shape, marked per-glyph).
 */
const GLYPHS: Record<IconName, ReactNode> = {
  calendar: (
    <>
      <rect x="4.25" y="5.25" width="15.5" height="14.5" rx="1.75" />
      <path d="M4.25 9.75h15.5" />
      <path d="M8.25 3.25v3M15.75 3.25v3" />
    </>
  ),
  'calendar-plus': (
    <>
      <rect x="4.25" y="5.25" width="15.5" height="14.5" rx="1.75" />
      <path d="M4.25 9.75h15.5" />
      <path d="M8.25 3.25v3M15.75 3.25v3" />
      <path d="M12 12.5v4.5M9.75 14.75h4.5" />
    </>
  ),
  chart: (
    <>
      <path d="M4.25 4.25V18.5a1.25 1.25 0 0 0 1.25 1.25h14.25" />
      <path d="M8.5 16v-4.5M12.5 16V7.5M16.5 16v-2.75" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.75V4A1.25 1.25 0 0 1 10.25 2.75h3.5A1.25 1.25 0 0 1 15 4v.75" />
      <path d="M15 4.75h2.75a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6.25a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5H9" />
      <path d="M8.75 10.25h6.5M8.75 13.5h6.5M8.75 16.75h4" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  dashboard: (
    <>
      <rect x="3.75" y="3.75" width="6.5" height="8.5" rx="1.25" />
      <rect x="13.75" y="3.75" width="6.5" height="4.5" rx="1.25" />
      <rect x="13.75" y="11.75" width="6.5" height="8.5" rx="1.25" />
      <rect x="3.75" y="15.75" width="6.5" height="4.5" rx="1.25" />
    </>
  ),
  download: (
    <>
      <path d="M12 4.25v10" />
      <path d="M7.75 10.5 12 14.75 16.25 10.5" />
      <path d="M4.25 15.75V18a1.75 1.75 0 0 0 1.75 1.75h12A1.75 1.75 0 0 0 19.75 18v-2.25" />
    </>
  ),
  building: (
    <>
      <path d="M5.25 20.25V5A1.25 1.25 0 0 1 6.5 3.75h11A1.25 1.25 0 0 1 18.75 5v15.25" />
      <path d="M3.5 20.25h17" />
      <path d="M8.5 7.75h1.75M13.75 7.75h1.75M8.5 11.25h1.75M13.75 11.25h1.75M8.5 14.75h1.75M13.75 14.75h1.75" />
      <path d="M10.5 20.25v-2.75a1.5 1.5 0 0 1 3 0v2.75" />
    </>
  ),
  file: (
    <>
      <path d="M13.25 3.75H7A1.25 1.25 0 0 0 5.75 5v14A1.25 1.25 0 0 0 7 20.25h10A1.25 1.25 0 0 0 18.25 19V8.75z" />
      <path d="M13.25 3.75v5h5" />
      <path d="M8.75 13.25h6.5M8.75 16.5h4.25" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 3.75c2.6 2.4 2.6 14.1 0 16.5M12 3.75c-2.6 2.4-2.6 14.1 0 16.5" />
      <path d="M3.75 12h16.5" />
    </>
  ),
  home: (
    <>
      <path d="M3.75 10.5 12 3.75l8.25 6.75" />
      <path d="M5.75 9v10a1.25 1.25 0 0 0 1.25 1.25h10A1.25 1.25 0 0 0 18.25 19V9" />
      <path d="M10 20.25v-4.75a2 2 0 0 1 4 0v4.75" />
    </>
  ),
  ledger: (
    <>
      <path d="M5.75 5.5A1.75 1.75 0 0 1 7.5 3.75h10.75v14.5H7.5A1.75 1.75 0 0 0 5.75 20z" />
      <path d="M5.75 20a1.75 1.75 0 0 1 1.75-1.75h10.75" />
      <path d="M9.25 8.25h6M9.25 11.5h4" />
    </>
  ),
  'log-out': (
    <>
      <path d="M13.75 4.25H6.5A1.75 1.75 0 0 0 4.75 6v12a1.75 1.75 0 0 0 1.75 1.75h7.25" />
      <path d="M15.75 8.25 19.5 12l-3.75 3.75" />
      <path d="M9.75 12h9.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  play: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M10.1 8.6l5.2 3.4-5.2 3.4z" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  receipt: (
    <>
      <path d="M6 3.75h12v15.5l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
      <path d="M9.25 8.25h5.5M9.25 11.75h5.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.75 3.75v4.25h-4.25" />
    </>
  ),
  save: (
    <>
      <path d="M4.75 5.5A1.75 1.75 0 0 1 6.5 3.75h9.25l3.5 3.5v11a1.75 1.75 0 0 1-1.75 1.75H6.5a1.75 1.75 0 0 1-1.75-1.75z" />
      <path d="M8 3.75V8a1 1 0 0 0 1 1h5.5a1 1 0 0 0 1-1V3.75" />
      <path d="M7.75 20v-4.5a1.5 1.5 0 0 1 1.5-1.5h5.5a1.5 1.5 0 0 1 1.5 1.5V20" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.25" />
      <path d="M15.5 15.5 20 20" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 6.25h15" />
      <path d="M9.5 6.25V4.75A1.5 1.5 0 0 1 11 3.25h2a1.5 1.5 0 0 1 1.5 1.5v1.5" />
      <path d="M6.5 6.25l.8 12.1a1.75 1.75 0 0 0 1.75 1.65h5.9a1.75 1.75 0 0 0 1.75-1.65l.8-12.1" />
      <path d="M10.1 10.5v5.5M13.9 10.5v5.5" />
    </>
  ),
  'trend-down': (
    <>
      <path d="M3.5 7.75l5.25 5.25 3.25-3.25 7.5 7.5" />
      <path d="M15.75 17.25h3.75v-3.75" />
    </>
  ),
  'trend-up': (
    <>
      <path d="M3.5 16.25l5.25-5.25 3.25 3.25 7.5-7.5" />
      <path d="M15.75 6.75h3.75v3.75" />
    </>
  ),
  upload: (
    <>
      <path d="M12 14.25v-10" />
      <path d="M7.75 8.5 12 4.25 16.25 8.5" />
      <path d="M4.25 15.75V18a1.75 1.75 0 0 0 1.75 1.75h12A1.75 1.75 0 0 0 19.75 18v-2.25" />
    </>
  ),
  'user-plus': (
    <>
      <circle cx="10" cy="8" r="3.25" />
      <path d="M4.25 19.75c0-3.2 2.6-5.25 5.75-5.25s5.75 2.05 5.75 5.25" />
      <path d="M19 8.25v5.5M16.25 11h5.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9.25" cy="8.25" r="3.5" />
      <path d="M3.25 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M15.25 5.15a3.5 3.5 0 0 1 0 6.2M17.9 14.6c1.7.8 2.85 2.4 2.85 4.9" />
    </>
  ),
  wallet: (
    <>
      <rect x="3.25" y="6.25" width="17.5" height="12.5" rx="2" />
      <path d="M15.5 11.25h5.25v3.5H15.5a1.75 1.75 0 0 1 0-3.5z" />
      <path d="M16.1 13h.01" strokeWidth="2.25" />
    </>
  ),
  wrench: (
    <path d="M13.9 5.1a4.75 4.75 0 0 0-5.4 7.05L3.3 17.3a2 2 0 0 0 2.83 2.83l5.15-5.15a4.75 4.75 0 0 0 7.05-5.4l-3.18 3.18-2.83-2.83z" />
  ),
  'chevron-left': <path d="M14.5 5.5 8 12l6.5 6.5" />,
  'chevron-right': <path d="M9.5 5.5 16 12l-6.5 6.5" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  /** Token size: sm 16 / md 20 / lg 24. Ignored when className sets h-/w-. */
  size?: IconSize;
  /**
   * Accessible name. Leave unset (default) for a decorative icon sitting next
   * to a text label; set it only when the icon IS the control's whole content.
   */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 'md', label, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={SIZE_PX[size]}
      height={SIZE_PX[size]}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  );
}
