'use client';

/**
 * Download the server-side CSV for a list screen. The API writes an `export`
 * action to the audit log and re-checks `reports.export` server-side; this
 * component only renders the affordance when the role would pass that check.
 */

import { roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

export function ExportCsvButton({
  kind,
  query = '',
}: {
  kind: 'tenants' | 'leases' | 'charges' | 'payments' | 'arrears';
  query?: string;
}) {
  const { t, session } = usePreferences();
  if (!roleHasPermission(session?.role as Role, 'reports.export')) return null;

  const href = `${api.exportCsvUrl(kind)}${query ? `?${query.replace(/^\?/, '')}` : ''}`;
  return (
    <a
      href={href}
      className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      aria-label={t('app.export_csv')}
    >
      {t('app.export_csv')}
    </a>
  );
}
