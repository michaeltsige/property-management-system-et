'use client';

import { useState } from 'react';

import { WORK_ORDER_STATUSES } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { Modal } from '@/components/modal';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Label,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '@/components/ui';

/**
 * Maintenance board: requests, priorities and the vendor doing the work. The
 * status machine is enforced by the API (open → assigned → in progress →
 * completed), so the buttons here only offer legal moves.
 *
 * Requests can be filed by tenants from the portal; staff manage them here.
 * Every request carries a note thread — closing a request requires a
 * tenant-visible closing note, and staff can also add internal notes that
 * tenants never see.
 */
export default function MaintenancePage() {
  const { t, language, calendar } = usePreferences();
  const [status, setStatus] = useState('');
  const board = useAsync(() => api.workOrders(`?pageSize=100${status ? `&status=${status}` : ''}`), [status]);
  const vendors = useAsync(() => api.vendors(), []);
  const [vendorFor, setVendorFor] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState('');
  const { pending, error, run } = useAction();

  // Detail drawer state: which request is open, plus a version bump so adding
  // a note re-fetches the thread without closing the modal.
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const detail = useAsync(
    () => (detailFor ? api.workOrder(detailFor) : Promise.resolve(null)),
    [detailFor, detailVersion],
  );
  const [noteBody, setNoteBody] = useState('');
  const [noteInternal, setNoteInternal] = useState(false);
  const [closeFor, setCloseFor] = useState<{ id: string; status: 'completed' | 'cancelled' } | null>(null);
  const [closingNote, setClosingNote] = useState('');

  async function advance(id: string, nextStatus: string, nextVendorId?: string) {
    await run(async () => {
      await api.updateWorkOrder(id, {
        status: nextStatus,
        ...(nextVendorId ? { vendorId: nextVendorId } : {}),
      });
      setVendorFor(null);
      board.reload();
    }).catch(() => undefined);
  }

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    if (!detailFor || noteBody.trim().length < 3) return;
    await run(async () => {
      await api.addWorkOrderNote(detailFor, { body: noteBody.trim(), internal: noteInternal });
      setNoteBody('');
      setNoteInternal(false);
      setDetailVersion((version) => version + 1);
    }).catch(() => undefined);
  }

  async function closeOrder() {
    if (!closeFor) return;
    await run(async () => {
      await api.updateWorkOrder(closeFor.id, {
        status: closeFor.status,
        resolutionNotes: closingNote.trim(),
      });
      setCloseFor(null);
      setClosingNote('');
      setDetailFor(null);
      board.reload();
    }).catch(() => undefined);
  }

  const rows = board.data?.items ?? [];
  const order = detail.data?.workOrder ?? null;

  return (
    <div>
      <PageHeader
        titleKey="nav.maintenance"
        description={`${t('dashboard.open_work_orders')}: ${board.data?.openCount ?? 0} · ${t('work_order.priority.urgent')}: ${
          board.data?.urgentCount ?? 0
        }`}
        actions={
          <>
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 w-40"
              aria-label={t('unit.status')}
            >
              <option value="">{t('common.filters')}</option>
              {WORK_ORDER_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {t(`work_order.status.${option}` as never)}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {error ? (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {board.loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title={t('common.no_results')} description={t('maintenance.new_request')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>{t('maintenance.title')}</Th>
                  <Th>{t('nav.properties')}</Th>
                  <Th>{t('maintenance.reported_by')}</Th>
                  <Th>{t('maintenance.priority')}</Th>
                  <Th>{t('maintenance.assign_vendor')}</Th>
                  <Th>{t('money.amount')}</Th>
                  <Th>{t('unit.status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setDetailFor(row.id)}
                  >
                    <Td className="tabular text-xs text-slate-500">{row.ticketNumber}</Td>
                    <Td>
                      <span className="font-medium text-slate-900">{row.title}</span>
                      <span className="block text-[11px] text-slate-500">
                        {row.category ?? '—'} · {formatDate(row.reportedAt, { language, calendar })}
                      </span>
                    </Td>
                    <Td>
                      {row.property?.name ?? '—'}
                      {row.unit?.label ? (
                        <span className="block text-[11px] text-slate-500">{row.unit.label}</span>
                      ) : null}
                    </Td>
                    <Td>{row.tenant?.fullName ?? '—'}</Td>
                    <Td>
                      <Badge
                        tone={
                          row.priority === 'urgent'
                            ? 'danger'
                            : row.priority === 'high'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`work_order.priority.${row.priority}` as never)}
                      </Badge>
                    </Td>
                    <Td>{row.vendor?.name ?? '—'}</Td>
                    <Td className="tabular">
                      {(row.actualCostMinor ?? row.estimatedCostMinor)
                        ? formatAmount(
                            row.actualCostMinor ?? row.estimatedCostMinor ?? '0',
                            row.currency,
                            language,
                          )
                        : '—'}
                    </Td>
                    <Td>
                      <Badge className={cn(statusTone[row.status])}>
                        {t(`work_order.status.${row.status}` as never)}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span onClick={(event) => event.stopPropagation()}>
                        {row.status === 'open' ? (
                          <Button variant="ghost" size="sm" onClick={() => setVendorFor(row.id)}>
                            {t('maintenance.assign_vendor')}
                          </Button>
                        ) : null}
                        {row.status === 'assigned' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void advance(row.id, 'in_progress')}
                          >
                            {t('work_order.status.in_progress')}
                          </Button>
                        ) : null}
                        {row.status === 'in_progress' ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => void advance(row.id, 'on_hold')}>
                              {t('work_order.status.on_hold')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setCloseFor({ id: row.id, status: 'completed' })}
                            >
                              {t('work_order.status.completed')}
                            </Button>
                          </>
                        ) : null}
                        {row.status === 'on_hold' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void advance(row.id, 'in_progress')}
                          >
                            {t('work_order.status.in_progress')}
                          </Button>
                        ) : null}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={vendorFor !== null}
        onOpenChange={(value) => (value ? undefined : setVendorFor(null))}
        title={t('maintenance.assign_vendor')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setVendorFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={pending || !vendorId}
              onClick={() => vendorFor && void advance(vendorFor, 'assigned', vendorId)}
            >
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="vendorId">{t('maintenance.assign_vendor')}</Label>
          <Select id="vendorId" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
            <option value="">—</option>
            {vendors.data?.vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
                {vendor.category ? ` · ${vendor.category}` : ''}
              </option>
            ))}
          </Select>
          {(vendors.data?.vendors.length ?? 0) === 0 ? (
            <p className="text-xs text-slate-500">
              No vendors yet — add a plumber or electrician from the API (`POST /vendors`) or the mobile app.
            </p>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>

      {/* Request detail: origin, note thread, staff actions. */}
      <Modal
        open={detailFor !== null}
        onOpenChange={(value) => {
          if (!value) {
            setDetailFor(null);
            setNoteBody('');
            setNoteInternal(false);
          }
        }}
        title={order?.ticketNumber ? `${order.ticketNumber} · ${order.title}` : t('maintenance.details')}
        footer={
          order ? (
            <>
              {order.status === 'open' ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setVendorFor(order.id);
                  }}
                >
                  {t('maintenance.assign_vendor')}
                </Button>
              ) : null}
              {order.status === 'assigned' ? (
                <Button variant="secondary" onClick={() => void advance(order.id, 'in_progress')}>
                  {t('work_order.status.in_progress')}
                </Button>
              ) : null}
              {order.status === 'open' ? (
                <Button
                  variant="secondary"
                  onClick={() => setCloseFor({ id: order.id, status: 'cancelled' })}
                >
                  {t('maintenance.cancel_request')}
                </Button>
              ) : null}
              {order.status === 'in_progress' ? (
                <Button onClick={() => setCloseFor({ id: order.id, status: 'completed' })}>
                  {t('maintenance.close_request')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      >
        {detail.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : order ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn(statusTone[order.status])}>
                {t(`work_order.status.${order.status}` as never)}
              </Badge>
              <Badge
                tone={
                  order.priority === 'urgent' ? 'danger' : order.priority === 'high' ? 'warning' : 'neutral'
                }
              >
                {t(`work_order.priority.${order.priority}` as never)}
              </Badge>
              <span className="text-xs text-slate-500">
                {order.property?.name ?? '—'}
                {order.unit?.label ? ` · ${order.unit.label}` : ''} ·{' '}
                {formatDate(order.reportedAt, { language, calendar })}
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium text-slate-700">{t('maintenance.reported_by')}:</span>{' '}
              {order.tenant?.fullName ?? t('common.none')}
              {order.tenant?.phone ? ` · ${order.tenant.phone}` : ''}
            </div>

            {order.description ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{order.description}</p>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium text-slate-900">{t('maintenance.notes')}</p>
              {(order.notes ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">{t('common.no_results')}</p>
              ) : (
                <ul className="space-y-2">
                  {(order.notes ?? []).map((note) => (
                    <li key={note.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">{note.authorName}</span>
                        <span>{formatDate(note.createdAt, { language, calendar })}</span>
                        {note.internal ? (
                          <Badge tone="warning">{t('maintenance.internal_note')}</Badge>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{note.body}</p>
                    </li>
                  ))}
                </ul>
              )}

              {!['completed', 'cancelled'].includes(order.status) ? (
                <form className="mt-3 space-y-2" onSubmit={addNote}>
                  <Textarea
                    aria-label={t('maintenance.add_note')}
                    placeholder={t('maintenance.add_note')}
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={noteInternal}
                        onChange={(event) => setNoteInternal(event.target.checked)}
                      />
                      {t('maintenance.internal_note')}
                    </label>
                    <Button size="sm" type="submit" disabled={pending || noteBody.trim().length < 3}>
                      {t('maintenance.add_note')}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>

            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        ) : null}
      </Modal>

      {/* Closing a request requires a tenant-visible note. */}
      <Modal
        open={closeFor !== null}
        onOpenChange={(value) => {
          if (!value) {
            setCloseFor(null);
            setClosingNote('');
          }
        }}
        title={
          closeFor?.status === 'completed' ? t('maintenance.close_request') : t('maintenance.cancel_request')
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCloseFor(null);
                setClosingNote('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button disabled={pending || closingNote.trim().length < 3} onClick={() => void closeOrder()}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="closingNote">{t('maintenance.closing_note')}</Label>
          <Textarea
            id="closingNote"
            required
            value={closingNote}
            onChange={(event) => setClosingNote(event.target.value)}
          />
          <p className="text-xs text-slate-500">{t('maintenance.closing_note_hint')}</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
