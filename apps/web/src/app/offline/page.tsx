'use client';

/**
 * The offline shell served by the service worker when a navigation fails.
 *
 * It is a client component so the copy follows the user's language preference
 * after hydration, and it offers exactly one action: try again.
 */

import { Refresh } from '@/components/icons';

import { Logo } from '@/components/logo';
import { usePreferences } from '@/lib/preferences';

import { Button } from '@/components/ui';

export default function OfflinePage() {
  const { t } = usePreferences();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      {/* The real brand mark (ink on the light canvas), not a stand-in glyph. */}
      <Logo size={56} className="mx-auto" />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-strong">{t('offline.title')}</h1>
        <p className="mt-1 max-w-sm text-sm text-soft">{t('offline.body')}</p>
      </div>
      <Button onClick={() => window.location.reload()}>
        <Refresh className="h-4 w-4" aria-hidden="true" />
        {t('offline.retry')}
      </Button>
    </div>
  );
}
