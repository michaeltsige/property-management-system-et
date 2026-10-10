'use client';

/**
 * Iconsax re-exports with React-19-safe defaults.
 *
 * `iconsax-react@0.0.8` declares its defaults through `defaultProps`, which
 * React 19 removed: `color` arrived as `undefined`, the Linear-variant paths
 * rendered `stroke={undefined}` (→ no paint), and every icon on screen became
 * an invisible empty SVG. This module wraps the icon set the app uses and
 * applies the same defaults explicitly, so `currentColor` tracks the text
 * color and the icons render again — while the call sites stay identical
 * (`<Home2 className="h-5 w-5" />`).
 */

import { forwardRef } from 'react';
import * as Iconsax from 'iconsax-react';

export type IconProps = {
  className?: string;
  size?: number | string;
  variant?: 'Linear' | 'Outline' | 'Broken' | 'Bold' | 'Bulk' | 'TwoTone';
  color?: string;
};

type SourceIcon = React.ComponentType<
  IconProps & { ref?: React.Ref<SVGSVGElement>; 'aria-hidden'?: string | boolean }
>;

function wrap(name: keyof typeof Iconsax) {
  const Source = Iconsax[name] as SourceIcon;
  const Wrapped = forwardRef<SVGSVGElement, IconProps & { 'aria-hidden'?: string | boolean }>(
    function WrappedIcon(props, ref) {
      const { size = 24, variant = 'Linear', color = 'currentColor', ...rest } = props;
      return <Source ref={ref} size={size} variant={variant} color={color} {...rest} />;
    },
  );
  Wrapped.displayName = `Iconsax.${name}`;
  return Wrapped;
}

// Navigation and shell
export const ArrowRight2 = wrap('ArrowRight2');
export const ArrowUp2 = wrap('ArrowUp2');
export const ArrowDown2 = wrap('ArrowDown2');
export const Element3 = wrap('Element3');
export const Home2 = wrap('Home2');
export const Building3 = wrap('Building3');
export const Profile2User = wrap('Profile2User');
export const Calendar2 = wrap('Calendar2');
export const ReceiptItem = wrap('ReceiptItem');
export const Wallet3 = wrap('Wallet3');
export const Chart = wrap('Chart');
export const Setting3 = wrap('Setting3');
export const Setting2 = wrap('Setting2');
export const DocumentText = wrap('DocumentText');
export const ClipboardText = wrap('ClipboardText');
export const People = wrap('People');
export const LanguageSquare = wrap('LanguageSquare');
export const Logout = wrap('Logout');
export const Menu = wrap('Menu');
export const SearchNormal1 = wrap('SearchNormal1');
export const Notification = wrap('Notification');
export const Global = wrap('Global');
