'use client';

import { Download, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { DOCUMENT_CATEGORIES, ALLOWED_UPLOAD_MIME_TYPES, DEFAULT_MAX_UPLOAD_BYTES } from '@pms/shared';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
import { Modal } from '@/components/modal';
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
  Table,
  Td,
  Th,
} from '@/components/ui';

/**
 * Documents. The API is JSON-only, so a file is read in the browser, base64
 * encoded and validated server-side (type, size, and that the linked record
 * belongs to this organization) before it is written to storage.
 */
export default function DocumentsPage() {
  const { t, language, calendar } = usePreferences();
  const documents = useAsync(() => api.documents('?pageSize=100'), []);
  const leases = useAsync(() => api.leases(), []);
  const tenants = useAsync(() => api.tenants(), []);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof DOCUMENT_CATEGORIES)[number]>('lease_agreement');
  const [leaseId, setLeaseId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const { pending, error, run } = useAction();

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

  const rows = documents.data?.items ?? [];

  return (
    <div>
      <PageHeader
        titleKey="nav.documents"
        description={`${ALLOWED_UPLOAD_MIME_TYPES.length} accepted file types · ${maxMb} MB maximum`}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('documents.upload')}
          </Button>
        }
      />

      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {documents.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('documents.upload')} />
          ) : (
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
                {rows.map((document) => (
                  <tr key={document.id}>
                    <Td>
                      <span className="font-medium text-slate-900">
                        {document.title ?? document.id.slice(0, 8)}
                      </span>
                      <span className="block text-[11px] text-slate-500">{document.mimeType}</span>
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
                        onClick={() => void download(document.id, document.title ?? 'document')}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('common.delete')}
                        onClick={() => void remove(document.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

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
            <p className="text-[11px] text-slate-500">
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
              {DOCUMENT_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="leaseId">{t('nav.leases')}</Label>
              <Select id="leaseId" value={leaseId} onChange={(event) => setLeaseId(event.target.value)}>
                <option value="">—</option>
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
                <option value="">—</option>
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
