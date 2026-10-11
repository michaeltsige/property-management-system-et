import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import { PreferencesProvider } from '@/lib/preferences';
import { PwaRegister } from '@/components/pwa-register';

import './globals.css';

/**
 * Plus Jakarta Sans is the one UI face — the owner picked it from the sidebar
 * typeface trial (the "Properties" entry). Ge'ez script has no glyphs in it,
 * so the stack in globals.css falls through to Noto Sans Ethiopic; Amharic and
 * Tigrinya still render everywhere.
 */
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', display: 'swap' });

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
      <body className={jakarta.variable}>
        <PreferencesProvider>{children}</PreferencesProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
