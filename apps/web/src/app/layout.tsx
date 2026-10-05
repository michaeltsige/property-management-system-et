import type { Metadata } from 'next';

import { PreferencesProvider } from '@/lib/preferences';

import './globals.css';

export const metadata: Metadata = {
  title: 'Property Management',
  description: 'Commercial property management for property owners and landlords in Ethiopia',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
