'use client';

/**
 * Route-level error boundary. Without this, any render error inside the staff
 * app blanked the whole screen — worse than the error it failed on.
 */

import { useEffect } from 'react';

import { Button, Card, CardContent } from '@/components/ui';
import { usePreferences } from '@/lib/preferences';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = usePreferences();

  useEffect(() => {
    // Surface the real error in the console for support; the UI stays generic.
    console.error('[app-error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">{t('error.generic')}</p>
          {error.digest ? <p className="font-mono text-[11px] text-slate-400">{error.digest}</p> : null}
          <Button onClick={reset} variant="secondary">
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
