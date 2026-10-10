import { cn } from '@/lib/utils';

/**
 * The product logo — the user-designed Rentalo mark (three teal towers over
 * the white "Rentalo" lettering), served as a static SVG and drawn inside a
 * white tile so the lettering keeps its contrast on dark rails and on light
 * pages alike. One asset everywhere: staff app, tenant portal, login screens.
 *
 * `size` is the tile edge; the mark sits at ~84% of it with a little breathing
 * room, the way an app icon does.
 */
export function Logo({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-900/10',
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Rentalo"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/rentalo-mark.svg"
        alt=""
        draggable={false}
        style={{ width: size * 0.84, height: size * 0.84 }}
      />
    </span>
  );
}
