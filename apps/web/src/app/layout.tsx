import type { Metadata, Viewport } from 'next';
import { Poppins, Plus_Jakarta_Sans, Lexend, Inter, DM_Sans } from 'next/font/google';

import { PreferencesProvider } from '@/lib/preferences';
import { PwaRegister } from '@/components/pwa-register';

import './globals.css';

/**
 * Poppins is the UI face (geometric, single-story `a` — reads as the product
 * brand). Ethiopic text has no glyphs in Poppins, so the stack falls through
 * to Noto Sans Ethiopic loaded in globals.css; Ge'ez still renders everywhere.
 */
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});

/**
 * Typeface trial (owner request): the four portfolio entries in the sidebar
 * rail are each rendered in a candidate family — pick the winner and it
 * becomes the one UI face; the losing variables are then removed.
 *   Properties → Plus Jakarta Sans (`--font-jakarta`)
 *   Units      → Lexend            (`--font-lexend`)
 *   Tenants    → Inter             (`--font-inter`)
 *   Leases     → DM Sans           (`--font-dm-sans`)
 */
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });
const lexend = Lexend({ subsets: ['latin'], variable: '--font-lexend', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Property Management',
  description: 'Commercial property management for property owners and landlords in Ethiopia',
  applicationName: 'Property Management',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Property',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '512x512', type: 'image/png' }],
  },
};

/**
 * Zooming is never disabled (WCAG 1.4.4); `viewportFit: cover` lets the app use
 * the full screen on phones with a notch.
 */
export const viewport: Viewport = {
  themeColor: '#1d6753',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={[poppins.variable, jakarta.variable, lexend.variable, inter.variable, dmSans.variable].join(' ')}>
        <PreferencesProvider>{children}</PreferencesProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
