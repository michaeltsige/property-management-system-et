import { cn } from '@/lib/utils';

/**
 * The product logo — the user-designed Rentalo mark (three teal towers over
 * the "Rentalo" lettering), served as a static SVG with a transparent
 * background: no white tile, the mark is the whole logo (owner request).
 *
 * Two tones:
 * - `onDark` (default): the original SVG with its white lettering — sidebar
 *   rails, dark headers.
 * - `onLight`: the derived ink variant (`rentalo-mark-ink.svg`), whose
 *   lettering is the brand's near-black so it survives on white pages —
 *   login screens, portal headers.
 *
 * The source SVG's viewBox is trimmed to the ink of the mark, so at equal
 * width the drawing is substantially larger than the padded original.
 */
export function Logo({
  size = 40,
  onDark = true,
  className,
}: {
  size?: number;
  /** Render the white-lettering variant (dark surfaces) when true. */
  onDark?: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={onDark ? '/brand/rentalo-mark.svg' : '/brand/rentalo-mark-ink.svg'}
      alt="Rentalo"
      role="img"
      draggable={false}
      className={cn('inline-block shrink-0 select-none', className)}
      style={{ width: size, height: size }}
    />
  );
}
