import { cn } from '@/lib/utils';

/**
 * The product logo — the user-designed Rentalo mark (three teal towers over
 * the "Rentalo" lettering), served as a static SVG with a transparent
 * background: no white tile, the mark is the whole logo (owner request).
 *
 * Two tones:
 * - `onDark` (true): the light variant (`rentalo-mark-light.svg`) — white
 *   wordmark over lifted shadows, trimmed to the ink of the mark so it reads
 *   big and legible on dark rails and hero overlays (owner request: the
 *   wordmark used to disappear on dark backgrounds).
 * - `onDark` (false): the ink variant (`rentalo-mark-ink.svg`), whose
 *   lettering is the brand's near-black so it survives on white pages.
 * - `onDark` (undefined): AUTO — the mark follows the theme. Both variants
 *   render and CSS picks (`dark:hidden` / `dark:inline-block`), so the logo
 *   is correct before hydration and needs no state. Use this on surfaces
 *   that change with the theme (the portal's phone header, the pay pages);
 *   always pin the prop on surfaces that stay dark (the rail, hero doors).
 */
export function Logo({
  size = 40,
  onDark,
  className,
}: {
  size?: number;
  /** Render the white-lettering variant (dark surfaces) when true. */
  onDark?: boolean;
  className?: string;
}) {
  if (onDark !== undefined) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={onDark ? '/brand/rentalo-mark-light.svg' : '/brand/rentalo-mark-ink.svg'}
        alt="Rentalo"
        role="img"
        draggable={false}
        className={cn('inline-block shrink-0 select-none', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/rentalo-mark-ink.svg"
        alt="Rentalo"
        role="img"
        draggable={false}
        className={cn('inline-block shrink-0 select-none dark:hidden', className)}
        style={{ width: size, height: size }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/rentalo-mark-light.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn('hidden shrink-0 select-none dark:inline-block', className)}
        style={{ width: size, height: size }}
      />
    </>
  );
}
