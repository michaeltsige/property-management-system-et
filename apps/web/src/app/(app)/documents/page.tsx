'use client';

import { Add, Import, Trash } from '@/components/icons';
import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  DOCUMENT_CATEGORY_GROUPS,
  ALLOWED_UPLOAD_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
  type DocumentCategory,
} from '@pms/shared';
import type { CalendarKind, LanguageCode } from '@pms/calendar';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { usePropertyContext } from '@/lib/property-context';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { Modal } from '@/components/modal';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '@/components/ui';

/**
 * Documents. The API is JSON-only, so a file is read in the browser, base64
 * encoded and validated server-side (type, size, and that the linked record
 * belongs to this organization) before it is written to storage.
 *
 * Layout (reviewed 4B direction): a left rail carries "All documents" (the
 * default view) plus one entry per category group with a live count; the
 * right column is a single table for the selected view. The selection lives
 * in the URL (`?group=lease_agreements`) so a view is linkable, survives a
 * reload, and the back button moves between views. `useSearchParams` needs a
 * Suspense boundary during prerender, hence the wrapper below.
 */
export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="space-y-2"><Skeleton className="h-10 w-56" /><Skeleton className="h-64 w-full" /></div>}>
      <DocumentsView />
    </Suspense>
  );
}

function DocumentsView() {
  const { t, language, calendar } = usePreferences();
  const router = useRouter();
  const searchParams = useSearchParams();
  const documents = useAsync(() => api.documents('?pageSize=100'), []);
  const leases = useAsync(() => api.leases(), []);
  const tenants = useAsync(() => api.tenants(), []);
  // The sidebar property scope: documents tagged with a property follow it;
  // organization-wide documents (no property) stay visible in every scope.
  const [propertyContext] = usePropertyContext();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<DocumentCategory>('lease_agreement');
  const [leaseId, setLeaseId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const { pending, error, run } = useAction();

  // `all` (no param) is the default view; an unknown param falls back to it.
  const activeGroup = searchParams.get('group') ?? 'all';

  function selectGroup(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('group');
    else params.set('group', next);
    const query = params.toString();
    router.push(query ? `/documents?${query}` : '/documents', { scroll: false });
  }

  const maxMb = Math.round(DEFAULT_MAX_UPLOAD_BYTES / 1024 / 1024);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    await run(async () => {
      const dataBase64 = await readAsBase64(file);
      await api.uploadDocument({
        category,
        title: file.name,
        filename: file.name,
        mimeType: file.type,
        dataBase64,
        leaseId: leaseId || undefined,
        tenantId: tenantId || undefined,
      });
      setOpen(false);
      setFile(null);
      setLeaseId('');
      setTenantId('');
      documents.reload();
    }).catch(() => undefined);
  }

  async function remove(id: string) {
    await run(async () => {
      await api.deleteDocument(id);
      documents.reload();
    }).catch(() => undefined);
  }

  /**
   * Downloads are fetched as a blob and handed to the browser, so the file never
   * needs a token in a query string. The proxy attaches the Bearer token from the
   * session cookie (ADR-0026).
   */
  async function download(id: string, filename: string) {
    const response = await fetch(`/api/v1/documents/${id}/download`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const visible = (documents.data?.items ?? [])
    .filter(
      (document) =>
        propertyContext === null || document.propertyId === null || document.propertyId === propertyContext,
    )
    .filter((document) => {
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      return (
        (document.title ?? '').toLowerCase().includes(needle) ||
        document.category.toLowerCase().includes(needle)
      );
    });
  const groups = DOCUMENT_CATEGORY_GROUPS.map((group) => ({
    ...group,
    items: visible.filter((document) => (group.categories as readonly string[]).includes(document.category)),
  }));

  const selected = groups.find((group) => group.key === activeGroup);
  const rows = selected ? selected.items : visible;
  const viewTitle = selected ? t(`documents.group_${selected.key}` as never) : t('documents.all');

  return (
    <div>
      <PageHeader
        titleKey="nav.documents"
        description={`${ALLOWED_UPLOAD_MIME_TYPES.length} accepted file types · ${maxMb} MB maximum`}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Add className="h-4 w-4" />
            {t('documents.upload')}
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/*
         * The rail: navigation, not a container — it sits directly on the
         * canvas. The selected entry is the one crisp chip (white, edged,
         * tiny shadow) so the current view reads at a glance; counts are
         * live (they follow the search and property scope).
         */}
        <nav aria-label={t('nav.documents')} className="min-w-0">
          <ul
            className={cn(
              'flex gap-1 overflow-x-auto pb-1',
              'lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0',
            )}
          >
            <li className="shrink-0 lg:shrink">
              <RailItem
                label={t('documents.all')}
                count={visible.length}
                active={activeGroup === 'all'}
                onSelect={() => selectGroup('all')}
                emphasized
              />
            </li>
            {groups.map((group) => (
              <li key={group.key} className="shrink-0 lg:shrink">
                <RailItem
                  label={t(`documents.group_${group.key}` as never)}
                  count={group.items.length}
                  active={activeGroup === group.key}
                  onSelect={() => selectGroup(group.key)}
                />
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          <div className="mb-3 max-w-sm">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('documents.search')}
              aria-label={t('documents.search')}
            />
          </div>

          {documents.loading ? (
            <Skeleton className="h-[512px] w-full" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{viewTitle}</CardTitle>
                <span className="text-xs text-muted tabular">{rows.length}</span>
              </CardHeader>
              {/*
                A stable frame: the table area never collapses below 24rem nor
                grows past 30rem, so paging between groups (248 lease papers vs
                a handful of inspections) keeps the same page length and the
                header actions never jump. Tall groups scroll inside the frame.
              */}
              <CardContent className="min-h-[384px] max-h-[480px] overflow-y-auto p-0">
                {rows.length === 0 ? (
                  <EmptyState
                    title={visible.length === 0 ? t('common.no_results') : t('documents.group_empty')}
                    description={visible.length === 0 ? t('documents.upload') : undefined}
                  />
                ) : (
                  <DocumentTable
                    items={rows}
                    language={language}
                    calendar={calendar}
                    onDownload={download}
                    onRemove={remove}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={t('documents.upload')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="document-form" type="submit" disabled={pending || !file}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="document-form" className="grid gap-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="file">{t('documents.file')}</Label>
            <Input
              id="file"
              ref={fileInput}
              type="file"
              accept={ALLOWED_UPLOAD_MIME_TYPES.join(',')}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              required
            />
            <p className="text-[11px] text-muted">
              PDF, JPEG, PNG, WebP, Word or Excel · up to {maxMb} MB
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="category">{t('documents.category')}</Label>
            <Select
              id="category"
              value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}
            >
              {DOCUMENT_CATEGORY_GROUPS.map((group) => (
                <optgroup key={group.key} label={t(`documents.group_${group.key}` as never)}>
                  {(group.categories as readonly string[]).map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="leaseId">{t('nav.leases')}</Label>
              <Select id="leaseId" value={leaseId} onChange={(event) => setLeaseId(event.target.value)}>
                <option value="">{t('common.select')}</option>
                {(leases.data?.leases ?? []).map((lease) => (
                  <option key={lease.id} value={lease.id}>
                    {lease.unit.property.name} · {lease.unit.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tenantId">{t('nav.tenants')}</Label>
              <Select id="tenantId" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
                <option value="">{t('common.select')}</option>
                {(tenants.data?.tenants ?? []).map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.fullName}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </form>
      </Modal>
    </div>
  );
}

/**
 * One rail entry. Geometry is identical for every state (a transparent
 * border keeps the layout stable) so the active chip never shifts the row.
 */
function RailItem({
  label,
  count,
  active,
  onSelect,
  emphasized,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-left text-sm transition-colors',
        active
          ? 'border-edge bg-surface font-medium text-strong shadow-card'
          : 'border-transparent text-soft hover:bg-white/60 hover:text-strong dark:hover:bg-white/5',
      )}
    >
      <span className={cn('min-w-0 truncate', emphasized && !active && 'font-medium text-body')}>
        {label}
      </span>
      <span className={cn('ml-auto shrink-0 text-xs tabular', active ? 'text-soft' : 'text-faint')}>
        {count}
      </span>
    </button>
  );
}

/** The one document table — file, category, size, date, actions. */
function DocumentTable({
  items,
  language,
  calendar,
  onDownload,
  onRemove,
}: {
  items: {
    id: string;
    title: string | null;
    category: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
  language: LanguageCode;
  calendar: CalendarKind;
  onDownload: (id: string, filename: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const { t } = usePreferences();
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t('documents.file')}</Th>
          <Th>{t('documents.category')}</Th>
          <Th>{t('documents.size')}</Th>
          <Th>{t('reports.period')}</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {items.map((document) => (
          <tr key={document.id}>
            <Td>
              <span className="font-medium text-strong">
                {document.title ?? document.id.slice(0, 8)}
              </span>
              <span className="block text-[11px] text-muted">{document.mimeType}</span>
            </Td>
            <Td>
              <Badge>{document.category.replace(/_/g, ' ')}</Badge>
            </Td>
            <Td className="tabular">{(document.sizeBytes / 1024).toFixed(0)} KB</Td>
            <Td>{formatDate(document.createdAt, { language, calendar })}</Td>
            <Td className="whitespace-nowrap">
              <Button
                variant="ghost"
                size="icon"
                title={t('documents.download')}
                onClick={() => void onDownload(document.id, document.title ?? 'document')}
              >
                <Import className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t('common.delete')}
                onClick={() => void onRemove(document.id)}
              >
                <Trash className="h-4 w-4" />
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

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
