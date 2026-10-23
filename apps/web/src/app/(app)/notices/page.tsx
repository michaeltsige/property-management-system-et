'use client';

/**
 * Notices — organization announcements, Telegram-style: a message with an
 * optional image, scoped to a property or the whole organization, aimed at
 * tenants, staff or everyone. Tenants read them in their portal; this screen is
 * the composer and the archive.
 */

import { useMemo, useRef, useState } from 'react';

import { NOTICE_AUDIENCES, roleHasPermission, type Role } from '@pms/shared';

import { PageHeader } from '@/components/app-shell';
import { Modal } from '@/components/modal';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

const AUDIENCE_TONE: Record<string, 'brand' | 'neutral' | 'gold'> = {
  tenants: 'brand',
  staff: 'neutral',
  all: 'gold',
};

export default function NoticesPage() {
  const { t, language, calendar, session } = usePreferences();
  const { pending, error, run } = useAction();
  const canWrite = roleHasPermission((session?.role ?? 'tenant') as Role, 'notices.write');

  const board = useAsync(() => api.notices(), []);
  const properties = useAsync(() => api.properties(), []);

  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [audience, setAudience] = useState<(typeof NOTICE_AUDIENCES)[number]>('tenants');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const propertyName = useMemo(() => {
    const map = new Map((properties.data?.properties ?? []).map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [properties.data]);

  function resetForm() {
    setTitle('');
    setBody('');
    setPropertyId('');
    setAudience('tenants');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function post() {
    if (body.trim().length === 0) return;
    await run(async () => {
      let imageDocumentId: string | undefined;
      if (file) {
        setUploading(true);
        try {
          const dataBase64 = await readAsBase64(file);
          const uploaded = await api.uploadDocument({
            category: 'other',
            title: title.trim() || file.name,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            dataBase64,
          });
          imageDocumentId = uploaded.document.id;
        } finally {
          setUploading(false);
        }
      }
      await api.createNotice({
        ...(title.trim() ? { title: title.trim() } : {}),
        body: body.trim(),
        ...(propertyId ? { propertyId } : {}),
        audience,
        ...(imageDocumentId ? { imageDocumentId } : {}),
      });
      setComposeOpen(false);
      resetForm();
      board.reload();
    }).catch(() => undefined);
  }

  async function remove(id: string) {
    await run(async () => {
      await api.deleteNotice(id);
      board.reload();
    }).catch(() => undefined);
  }

  return (
    <div>
      <PageHeader
        titleKey="notices.title"
        description={t('notices.subtitle')}
        actions={
          canWrite ? (
            <Button onClick={() => setComposeOpen(true)}>{t('notices.compose')}</Button>
          ) : undefined
        }
      />

      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {board.loading ? (
          <>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        ) : (board.data?.items ?? []).length === 0 ? (
          <Card className="lg:col-span-2">
            <CardContent>
              <EmptyState title={t('notices.empty')} description={canWrite ? t('notices.compose') : undefined} />
            </CardContent>
          </Card>
        ) : (
          (board.data?.items ?? []).map((notice) => {
            const image = notice.imageDocumentId ? api.noticeImageUrl(notice.id) : null;
            return (
              <Card key={notice.id} className="overflow-hidden">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- session-cookie-authenticated same-origin image
                  <img
                    src={image}
                    alt=""
                    loading="lazy"
                    className="max-h-72 w-full border-b border-line object-cover"
                  />
                ) : null}
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={AUDIENCE_TONE[notice.audience] ?? 'neutral'}>
                      {t(`notices.audience.${notice.audience}` as never)}
                    </Badge>
                    {propertyName(notice.propertyId) ? (
                      <span className="text-xs text-muted">{propertyName(notice.propertyId)}</span>
                    ) : (
                      <span className="text-xs text-faint">{t('notices.all_properties')}</span>
                    )}
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-muted hover:text-danger"
                        onClick={() => void remove(notice.id)}
                        disabled={pending}
                      >
                        {t('notices.delete')}
                      </Button>
                    ) : null}
                  </div>
                  {notice.title ? (
                    <h3 className="text-sm font-semibold text-strong">{notice.title}</h3>
                  ) : null}
                  <p className="whitespace-pre-wrap text-sm text-body">{notice.body}</p>
                  <p className="text-xs text-faint">
                    {notice.authorName ? `${notice.authorName} · ` : ''}
                    {formatDate(notice.publishedAt, { language, calendar })}
                  </p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Modal
        open={composeOpen}
        onOpenChange={(value) => (value ? undefined : setComposeOpen(false))}
        title={t('notices.compose')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setComposeOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={pending || uploading || body.trim().length === 0}
              onClick={() => void post()}
            >
              {uploading ? t('notices.uploading_image') : pending ? t('app.loading') : t('notices.post')}
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="notice-title">{t('maintenance.title')}</Label>
            <Input
              id="notice-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notice-body">{t('notices.body')}</Label>
            <Textarea
              id="notice-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={4000}
              rows={5}
              placeholder={t('notices.body_placeholder')}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="notice-audience">{t('notices.audience')}</Label>
              <Select
                id="notice-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value as typeof audience)}
              >
                {NOTICE_AUDIENCES.map((option) => (
                  <option key={option} value={option}>
                    {t(`notices.audience.${option}` as never)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="notice-property">{t('notices.property_scope')}</Label>
              <Select
                id="notice-property"
                value={propertyId}
                onChange={(event) => setPropertyId(event.target.value)}
              >
                <option value="">{t('notices.all_properties')}</option>
                {(properties.data?.properties ?? []).map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notice-image">{t('notices.image')}</Label>
            <input
              ref={fileInputRef}
              id="notice-image"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-body file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-900/40 dark:file:text-brand-200"
            />
            <p className="text-xs text-muted">{t('notices.image_hint')}</p>
          </div>
          {error ? <Alert tone="danger">{t('notices.image_failed')}</Alert> : null}
        </form>
      </Modal>
    </div>
  );
}
