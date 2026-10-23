'use client';

/**
 * Lease papers, receipts and anything the landlord filed for this tenant —
 * read-only, downloaded through the scoped API route.
 */

import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { DOCUMENT_CATEGORY_GROUPS } from '@pms/shared';
import type { PortalDocument } from '@/lib/types';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from '@/components/ui';

/**
 * Bucket the flat API list into the presentation groups (`@pms/shared`), the
 * same six names the staff documents screen uses. A category no group claims
 * (storage can grow before the groups do) lands in `other`, empty groups are
 * dropped so the page never shows vacant headings, and inside each group the
 * lease agreement keeps leading — it is the one paper tenants look for.
 */
function groupPortalDocuments(items: PortalDocument[]) {
  const leaseFirst = [...items].sort((a, b) => {
    const rank = (category: string) => (category === 'lease_agreement' ? 0 : 1);
    return rank(a.category) - rank(b.category);
  });
  const claimed = new Set(
    DOCUMENT_CATEGORY_GROUPS.flatMap((group) => group.categories as readonly string[]),
  );
  const groups = DOCUMENT_CATEGORY_GROUPS.map((group) => ({
    key: group.key,
    items: leaseFirst.filter((document) =>
      (group.categories as readonly string[]).includes(document.category),
    ),
  }));
  const other = groups.find((group) => group.key === 'other');
  for (const document of leaseFirst) {
    if (!claimed.has(document.category) && other) other.items.push(document);
  }
  return groups.filter((group) => group.items.length > 0);
}

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
      <h1 className="text-xl font-semibold tracking-tight text-strong">{t('portal.documents')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('portal.documents')}</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {/* The lease agreement is the one paper tenants look for, so it
              leads. On wider screens the papers sit in two columns of crisp
              containers (the depth system's 1C language) so the page does
              not read as a lonely single list on a big monitor. */}
          {documents.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : documents.error ? (
            <div className="space-y-3">
              <Alert tone="danger">
                {t('portal.load_failed')} {documents.error}
              </Alert>
              <Button variant="secondary" onClick={() => documents.reload()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (documents.data?.items.length ?? 0) === 0 ? (
            <EmptyState title={t('portal.documents_empty')} description="" />
          ) : (
            // One section per group that has papers — the same scan order as
            // the staff screen (tenant data, lease, payments, …). 1C cards:
            // single column on the phone, two on sm and up.
            <div className="space-y-5">
              {groupPortalDocuments(documents.data?.items ?? []).map((group) => (
                <section key={group.key}>
                  <h2 className="mb-2 text-sm font-semibold text-strong">
                    {t(`documents.group_${group.key}` as never)}
                  </h2>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {group.items.map((document) => (
                      <li
                        key={document.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-strong">
                            {document.title ?? document.category}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {[document.property, document.unit].filter(Boolean).join(' · ')}
                            {document.property || document.unit ? ' · ' : ''}
                            {formatDate(document.createdAt, { language, calendar })}
                          </p>
                        </div>
                        <a
                          href={api.portalDocumentUrl(document.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-body transition-colors hover:bg-wash"
                        >
                          {t('portal.download')}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
