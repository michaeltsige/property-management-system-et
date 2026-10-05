'use client';

/**
 * The offline shell served by the service worker when a navigation fails.
 *
 * It is a client component so the copy follows the user's language preference
 * after hydration, and it offers exactly one action: try again.
 */

import { RefreshCw } from 'lucide-react';

import { usePreferences } from '@/lib/preferences';

import { Button } from '@/components/ui';

export default function OfflinePage() {
  const { t } = usePreferences();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
        ቤ
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-900">{t('offline.title')}</h1>
        <p className="mt-1 max-w-sm text-sm text-slate-600">{t('offline.body')}</p>
      </div>
      <Button onClick={() => window.location.reload()}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        {t('offline.retry')}
      </Button>
    </div>
  );
}
