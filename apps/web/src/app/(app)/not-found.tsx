'use client';

/**
 * 404 inside the staff app: a link to a deleted unit or a mistyped URL should
 * look like a dead end with a way back, not a blank screen.
 */

import Link from 'next/link';

import { Button, Card, CardContent } from '@/components/ui';
import { usePreferences } from '@/lib/preferences';

export default function AppNotFound() {
  const { t } = usePreferences();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">404</p>
          <p className="text-sm text-slate-600">{t('error.not_found')}</p>
          <Link href="/dashboard">
            <Button variant="secondary">{t('nav.dashboard')}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
