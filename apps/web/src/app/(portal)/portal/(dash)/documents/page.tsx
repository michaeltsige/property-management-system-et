'use client';

/**
 * Lease papers, receipts and anything the landlord filed for this tenant —
 * read-only, downloaded through the scoped API route.
 */

import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from '@/components/ui';

export default function PortalDocumentsPage() {
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const documents = useAsync(
    () => (isTenant && ready ? api.portalDocuments() : Promise.resolve(null)),
    [isTenant, ready],
  );

  if (!ready || !isTenant) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">{t('portal.documents')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.documents')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {documents.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : documents.error ? (
            <div className="p-4 text-sm text-red-700">{documents.error}</div>
          ) : (documents.data?.items.length ?? 0) === 0 ? (
            <div className="p-4">
              <EmptyState title={t('portal.documents_empty')} description="" />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(documents.data?.items ?? []).map((document) => (
                <li key={document.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {document.title ?? document.category}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {[document.property, document.unit].filter(Boolean).join(' · ')}
                      {document.property || document.unit ? ' · ' : ''}
                      {formatDate(document.createdAt, { language, calendar })}
                    </p>
                  </div>
                  <a
                    href={api.portalDocumentUrl(document.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    {t('portal.download')}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
