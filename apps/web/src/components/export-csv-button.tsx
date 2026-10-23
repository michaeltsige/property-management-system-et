'use client';

/**
 * Download the server-side CSV for a list screen. The API writes an `export`
 * action to the audit log and re-checks `reports.export` server-side; this
 * component only renders the affordance when the role would pass that check.
 */

import { roleHasPermission, type Role } from '@pms/shared';

import { Export } from '@/components/icons';
import { api } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';

export function ExportCsvButton({
  kind,
  query = '',
}: {
  kind: 'tenants' | 'leases' | 'charges' | 'payments' | 'arrears' | 'units';
  query?: string;
}) {
  const { t, session } = usePreferences();
  if (!roleHasPermission(session?.role as Role, 'reports.export')) return null;

  const href = `${api.exportCsvUrl(kind)}${query ? `?${query.replace(/^\?/, '')}` : ''}`;
  return (
    <a
      href={href}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-3 text-sm font-medium text-body transition-colors hover:bg-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      aria-label={t('app.export_csv')}
    >
      <Export className="h-4 w-4 sm:hidden" aria-hidden="true" />
      <span className="hidden sm:inline">{t('app.export_csv')}</span>
      <span className="sm:hidden">CSV</span>
    </a>
  );
}
