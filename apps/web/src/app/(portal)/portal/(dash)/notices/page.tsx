'use client';

/**
 * Every in-app notice the organization sent this tenant, newest first. The
 * dashboard shows the top few; this is the full history. Message bodies are
 * translated on the client from the stored template key, so a tenant switching
 * language sees their history in the language they switched to.
 *
 * Above the notices sit the staff-posted ANNOUNCEMENTS (with their pictures,
 * Telegram-style): they are their own feed, and the section is deliberately
 * quiet — nothing renders while it loads, or when the API has none — so the
 * page keeps working before the backend ships the feature.
 */

import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { api } from '@/lib/api';
import { Alert, Button, Card, CardContent, EmptyState, Skeleton } from '@/components/ui';
import { TickCircle, Warning2 } from '@/components/icons';

/** Notices sent by staff carry `{ values, renderedStatus }`; system notices store flat values. */
function noticeValues(payload: unknown): Record<string, string | number> {
  if (payload && typeof payload === 'object' && 'values' in payload) {
    return ((payload as { values?: Record<string, string | number> }).values ?? {}) as Record<
      string,
      string | number
    >;
  }
  return (payload ?? {}) as Record<string, string | number>;
}

export default function PortalNoticesPage() {
  const { session, ready, language, calendar, t } = usePreferences();
  const isTenant = session?.role === 'tenant';

  const notices = useAsync(
    () => (isTenant && ready ? api.portalNotices() : Promise.resolve(null)),
    [isTenant, ready],
  );
  // Best-effort companion feed: a failure or an empty list just means no
  // announcements section today.
  const announcements = useAsync(
    () => (isTenant && ready ? api.portalAnnouncements() : Promise.resolve(null)),
    [isTenant, ready],
  );

  if (!ready || !isTenant) return null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-strong">{t('portal.notices_title')}</h1>

      {/* Announcements: the staff's posts, newest first. Rendered only when
          there is something to show — no skeleton, no error UI. */}
      {(announcements.data?.items.length ?? 0) > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-strong">{t('portal.announcements')}</h2>
          <ul className="mt-2 space-y-3">
            {(announcements.data?.items ?? []).map((item) => (
              <li key={item.id}>
                <Card>
                  <CardContent className="p-4">
                    {item.title ? <p className="font-semibold text-strong">{item.title}</p> : null}
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="mt-3 w-full rounded-lg border border-line object-cover max-h-96"
                        loading="lazy"
                      />
                    ) : null}
                    <p className="mt-3 whitespace-pre-wrap text-sm text-body">{item.body}</p>
                    <p className="mt-2 text-[11px] text-faint">
                      {[item.authorName, formatDate(item.publishedAt, { language, calendar })]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {notices.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : notices.error ? (
            <div className="space-y-3 p-4">
              <Alert tone="danger">
                {t('portal.load_failed')} {notices.error}
              </Alert>
              <Button variant="secondary" onClick={() => notices.reload()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (notices.data?.items.length ?? 0) === 0 ? (
            <div className="p-4">
              <EmptyState title={t('portal.notices_empty')} description="" />
            </div>
          ) : (
            <ul className="divide-y divide-line-soft">
              {(notices.data?.items ?? []).map((notice) => (
                <li key={notice.id} className="flex items-start gap-3 px-4 py-3">
                  {notice.templateKey === 'notification.payment_received' ? (
                    <TickCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
                  ) : (
                    <Warning2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-strong">
                      {t(notice.templateKey as never, noticeValues(notice.payload) as never)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {formatDate(notice.createdAt, { language, calendar })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
