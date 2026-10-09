'use client';

/**
 * The audit trail. `AuditLog` rows were written diligently from day one but had
 * no reader; this screen surfaces them with the same scoping the API applies —
 * only this organization, only what `audit.read` allows.
 */

import { useState } from 'react';

import { roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';

import { PageHeader } from '@/components/app-shell';
import { Alert, Badge, EmptyState, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';

const ACTIONS = ['create', 'update', 'delete', 'login', 'logout', 'export', 'reversal'] as const;

export default function AuditPage() {
  const { t, language, calendar, session } = usePreferences();
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const canRead = roleHasPermission(session?.role as Role, 'audit.read');
  const logs = useAsync(
    () => (canRead ? api.auditLogs(query) : Promise.resolve(null)),
    [canRead, query],
  );

  if (!canRead) {
    return (
      <>
        <PageHeader titleKey="nav.audit" description={t('audit.subtitle')} />
        <Alert tone="danger">{t('error.forbidden')}</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader titleKey="nav.audit" description={t('audit.subtitle')} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          aria-label={t('audit.action')}
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            const params = new URLSearchParams();
            if (event.target.value) params.set('action', event.target.value);
            if (search) params.set('entityType', search);
            setQuery(params.size > 0 ? `?${params.toString()}` : '');
          }}
          className="max-w-44"
        >
          <option value="">{t('audit.action')}: —</option>
          {ACTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <Input
          aria-label={t('audit.entity')}
          placeholder={t('audit.entity')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const params = new URLSearchParams();
              if (action) params.set('action', action);
              if (search) params.set('entityType', search);
              setQuery(params.size > 0 ? `?${params.toString()}` : '');
            }
          }}
          className="max-w-56"
        />
      </div>

      {logs.loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : logs.error ? (
        <Alert tone="danger">{logs.error}</Alert>
      ) : (logs.data?.items.length ?? 0) === 0 ? (
        <EmptyState title={t('audit.empty')} description="" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('audit.when')}</Th>
              <Th>{t('audit.actor')}</Th>
              <Th>{t('audit.action')}</Th>
              <Th>{t('audit.entity')}</Th>
            </tr>
          </thead>
          <tbody>
            {(logs.data?.items ?? []).map((entry) => (
              <tr key={entry.id}>
                <Td className="whitespace-nowrap">{formatDate(entry.createdAt, { language, calendar })}</Td>
                <Td>{entry.actor?.fullName ?? entry.actor?.email ?? '—'}</Td>
                <Td>
                  <Badge>{entry.action}</Badge>
                </Td>
                <Td>
                  <span className="text-slate-900">{entry.entityType}</span>
                  {entry.entityId ? (
                    <span className="ml-1 font-mono text-[11px] text-slate-400">
                      {entry.entityId.slice(0, 8)}
                    </span>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
