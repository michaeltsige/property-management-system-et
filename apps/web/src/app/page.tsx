'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { loadSession } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

/** Send the visitor to the right place: the dashboard or the sign-in screen. */
export default function HomePage() {
  const router = useRouter();
  const { ready, session } = usePreferences();

  useEffect(() => {
    if (!ready) return;
    router.replace((session ?? loadSession()) ? '/dashboard' : '/login');
  }, [ready, session, router]);

  return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
}
