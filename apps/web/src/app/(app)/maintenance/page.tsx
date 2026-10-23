'use client';

import { useEffect, useMemo, useState } from 'react';

import { WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, roleHasPermission, type Role } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
import { usePropertyContext } from '@/lib/property-context';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/app-shell';
import { MoneyInput } from '@/components/form-controls';
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
  const { t, language, calendar, session } = usePreferences();
  // The owner decides people and money; managers progress the work and estimate.
  const canDecide = roleHasPermission((session?.role ?? 'tenant') as Role, 'maintenance.assign');
  const [status, setStatus] = useState('');
  // The sidebar property scope: work orders carry their property directly.
  const [propertyContext] = usePropertyContext();
  const board = useAsync(() => api.workOrders(`?pageSize=100${status ? `&status=${status}` : ''}`), [status]);
  const vendors = useAsync(() => api.vendors(), []);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [maintainerName, setMaintainerName] = useState('');
  const [openSuggestions, setOpenSuggestions] = useState(false);
  const suggestionItems = useMemo(() => {
    const query = maintainerName.trim().toLowerCase();
    const list = vendors.data?.vendors ?? [];
    const filtered = query
      ? list.filter((vendor) => vendor.name.toLowerCase().includes(query))
      : list;
    return filtered.slice(0, 8);
  }, [vendors.data, maintainerName]);
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
  const [closingCost, setClosingCost] = useState<number | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  // Staff-side creation: a request plus its optional estimate, so the amount is
  // on the record from day one and shows in the table immediately.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    propertyId: '',
    unitId: '',
    title: '',
    description: '',
    priority: 'normal',
  });
  const [createEstimate, setCreateEstimate] = useState<number | null>(null);
  const [createMaintainer, setCreateMaintainer] = useState('');
  const properties = useAsync(() => api.properties(), []);
  const units = useAsync(() => api.units(), []);
  // Follow the stored estimate so reopening (or saving) shows the real value
  // and clearing it sticks.
  useEffect(() => {
    const stored = detail.data?.workOrder.estimatedCostMinor;
    setEstimate(stored ? Number(stored) : null);
  }, [detail.data]);

  async function advance(id: string, nextStatus: string, nextMaintainer?: string) {
    await run(async () => {
      await api.updateWorkOrder(id, {
        status: nextStatus,
        ...(nextMaintainer ? { maintainerName: nextMaintainer } : {}),
      });
      setAssignFor(null);
      setMaintainerName('');
      board.reload();
    }).catch(() => undefined);
  }

  async function saveEstimate() {
    if (!detailFor) return;
    const order = detail.data?.workOrder;
    if (!order) return;
    await run(async () => {
      await api.updateWorkOrder(detailFor, {
        estimatedCost:
          estimate === null ? null : { amountMinor: estimate, currency: order.currency },
      });
      setDetailVersion((version) => version + 1);
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
    const order = detail.data?.workOrder;
    await run(async () => {
      await api.updateWorkOrder(closeFor.id, {
        status: closeFor.status,
        resolutionNotes: closingNote.trim(),
        // Owner-only server-side; only sent when the owner filed an amount.
        ...(canDecide && closingCost !== null && order
          ? { actualCost: { amountMinor: closingCost, currency: order.currency } }
          : {}),
      });
      setCloseFor(null);
      setClosingNote('');
      setClosingCost(null);
      setDetailFor(null);
      board.reload();
    }).catch(() => undefined);
  }

  const rows = (board.data?.items ?? []).filter(
    (order) => propertyContext === null || order.property?.id === propertyContext,
  );
  const order = detail.data?.workOrder ?? null;
  const createUnits = (units.data?.units ?? []).filter(
    (unit) => unit.propertyId === createForm.propertyId,
  );

  async function createOrder() {
    if (!createForm.propertyId || createForm.title.trim().length < 3) return;
    await run(async () => {
      await api.createWorkOrder({
        propertyId: createForm.propertyId,
        ...(createForm.unitId ? { unitId: createForm.unitId } : {}),
        title: createForm.title.trim(),
        ...(createForm.description.trim() ? { description: createForm.description.trim() } : {}),
        priority: createForm.priority,
        ...(createEstimate !== null
          ? {
              estimatedCost: {
                amountMinor: createEstimate,
                currency: session?.organization.currency ?? 'ETB',
              },
            }
          : {}),
        ...(canDecide && createMaintainer.trim() ? { maintainerName: createMaintainer.trim() } : {}),
      });
      setCreateOpen(false);
      setCreateForm({ propertyId: '', unitId: '', title: '', description: '', priority: 'normal' });
      setCreateEstimate(null);
      setCreateMaintainer('');
      board.reload();
    }).catch(() => undefined);
  }

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
            <Button onClick={() => setCreateOpen(true)}>{t('maintenance.new_request')}</Button>
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
                  <Th>{t('maintenance.maintainer')}</Th>
                  <Th>{t('money.amount')}</Th>
                  <Th>{t('unit.status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-wash"
                    onClick={() => setDetailFor(row.id)}
                  >
                    <Td className="tabular text-xs text-muted">{row.ticketNumber}</Td>
                    <Td>
                      <span className="font-medium text-strong">{row.title}</span>
                      <span className="block text-[11px] text-muted">
                        {row.category ?? '—'} · {formatDate(row.reportedAt, { language, calendar })}
                      </span>
                    </Td>
                    <Td>
                      {row.property?.name ?? '—'}
                      {row.unit?.label ? (
                        <span className="block text-[11px] text-muted">{row.unit.label}</span>
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
                    <Td>{row.maintainerName ?? row.vendor?.name ?? '—'}</Td>
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
                        {row.status === 'open' && canDecide ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setMaintainerName('');
                              setAssignFor(row.id);
                            }}
                          >
                            {t('maintenance.assign_maintainer')}
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
        open={assignFor !== null}
        onOpenChange={(value) => (value ? undefined : setAssignFor(null))}
        title={t('maintenance.assign_maintainer')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={pending || maintainerName.trim().length === 0}
              onClick={() => assignFor && void advance(assignFor, 'assigned', maintainerName.trim())}
            >
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <Label htmlFor="maintainerName">{t('maintenance.maintainer')}</Label>
          {/* Free text, suggestions only: a person, a company, whoever shows up.
              A custom listbox instead of a native <datalist> — the browser-drawn
              suggestion popup cannot be styled and anchors inconsistently. */}
          <div className="relative">
            <Input
              id="maintainerName"
              role="combobox"
              aria-expanded={openSuggestions}
              aria-controls="maintainer-suggestions"
              aria-autocomplete="list"
              value={maintainerName}
              onChange={(event) => {
                setMaintainerName(event.target.value);
                setOpenSuggestions(true);
              }}
              onFocus={() => setOpenSuggestions(true)}
              onBlur={() => setTimeout(() => setOpenSuggestions(false), 120)}
              placeholder={t('maintenance.maintainer_hint')}
              autoComplete="off"
            />
            {openSuggestions && suggestionItems.length > 0 && (
              <ul
                id="maintainer-suggestions"
                role="listbox"
                className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-md bg-surface py-1 shadow-float"
              >
                {suggestionItems.map((vendor) => (
                  <li key={vendor.id} role="option" aria-selected={maintainerName === vendor.name}>
                    <button
                      type="button"
                      className="block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-wash-strong"
                      onMouseDown={(event) => {
                        // Pick on mousedown so the input's blur does not eat the click.
                        event.preventDefault();
                        setMaintainerName(vendor.name);
                        setOpenSuggestions(false);
                      }}
                    >
                      {vendor.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted">{t('maintenance.maintainer_hint')}</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>

      {/* New request: the amount field feeds the table's Amount column directly. */}
      <Modal
        open={createOpen}
        onOpenChange={(value) => (value ? undefined : setCreateOpen(false))}
        title={t('maintenance.new_request')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={pending || !createForm.propertyId || createForm.title.trim().length < 3}
              onClick={() => void createOrder()}
            >
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void createOrder(); }} id="work-order-create-form">
          <div className="space-y-1">
            <Label htmlFor="wo-property">{t('nav.properties')}</Label>
            <Select
              id="wo-property"
              value={createForm.propertyId}
              onChange={(event) =>
                setCreateForm((form) => ({ ...form, propertyId: event.target.value, unitId: '' }))
              }
              required
            >
              <option value="">—</option>
              {(properties.data?.properties ?? []).map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wo-unit">{t('unit.label')}</Label>
            <Select
              id="wo-unit"
              value={createForm.unitId}
              onChange={(event) => setCreateForm((form) => ({ ...form, unitId: event.target.value }))}
            >
              <option value="">—</option>
              {createUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="wo-title">{t('maintenance.title')}</Label>
            <Input
              id="wo-title"
              value={createForm.title}
              onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))}
              minLength={3}
              maxLength={160}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wo-description">{t('maintenance.description')}</Label>
            <textarea
              id="wo-description"
              className="flex min-h-20 w-full rounded-md border border-edge bg-canvas px-3 py-2 text-sm text-body placeholder:text-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              value={createForm.description}
              onChange={(event) => setCreateForm((form) => ({ ...form, description: event.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wo-priority">{t('maintenance.priority')}</Label>
            <Select
              id="wo-priority"
              value={createForm.priority}
              onChange={(event) => setCreateForm((form) => ({ ...form, priority: event.target.value }))}
            >
              {WORK_ORDER_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {t(`work_order.priority.${option}` as never)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <MoneyInput
              value={createEstimate}
              onChange={setCreateEstimate}
              currency={session?.organization.currency ?? 'ETB'}
              label={t('maintenance.estimate')}
              id="wo-estimate"
            />
            <p className="text-xs text-muted">{t('maintenance.estimate_hint')}</p>
          </div>
          {canDecide ? (
            <div className="space-y-1">
              <Label htmlFor="wo-maintainer">{t('maintenance.maintainer')}</Label>
              <Input
                id="wo-maintainer"
                value={createMaintainer}
                onChange={(event) => setCreateMaintainer(event.target.value)}
                maxLength={120}
              />
              <p className="text-xs text-muted">{t('maintenance.maintainer_hint')}</p>
            </div>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </form>
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
              {order.status === 'open' && canDecide ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMaintainerName(order.maintainerName ?? '');
                    setAssignFor(order.id);
                  }}
                >
                  {t('maintenance.assign_maintainer')}
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
              <span className="text-xs text-muted">
                {order.property?.name ?? '—'}
                {order.unit?.label ? ` · ${order.unit.label}` : ''} ·{' '}
                {formatDate(order.reportedAt, { language, calendar })}
              </span>
            </div>

            <div className="rounded-lg border border-line bg-wash px-3 py-2 text-xs text-soft">
              <span className="font-medium text-body">{t('maintenance.reported_by')}:</span>{' '}
              {order.tenant?.fullName ?? t('common.none')}
              {order.tenant?.phone ? ` · ${order.tenant.phone}` : ''}
              <span className="mx-2 text-faint">|</span>
              <span className="font-medium text-body">{t('maintenance.maintainer')}:</span>{' '}
              {order.maintainerName ?? order.vendor?.name ?? t('common.none')}
            </div>

            {!['completed', 'cancelled'].includes(order.status) ? (
              <div className="rounded-lg border border-line px-3 py-3">
                <MoneyInput
                  label={t('maintenance.estimate')}
                  value={estimate}
                  onChange={setEstimate}
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-muted">{t('maintenance.estimate_hint')}</p>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => void saveEstimate()}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            ) : null}

            {order.description ? (
              <p className="whitespace-pre-wrap text-sm text-body">{order.description}</p>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-medium text-strong">{t('maintenance.notes')}</p>
              {(order.notes ?? []).length === 0 ? (
                <p className="text-xs text-muted">{t('common.no_results')}</p>
              ) : (
                <ul className="space-y-2">
                  {(order.notes ?? []).map((note) => (
                    <li key={note.id} className="rounded-lg border border-line px-3 py-2">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
                        <span className="font-medium text-body">{note.authorName}</span>
                        <span>{formatDate(note.createdAt, { language, calendar })}</span>
                        {note.internal ? (
                          <Badge tone="warning">{t('maintenance.internal_note')}</Badge>
                        ) : null}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-body">{note.body}</p>
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
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-soft">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-line"
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
          <p className="text-xs text-muted">{t('maintenance.closing_note_hint')}</p>
          {canDecide && closeFor?.status === 'completed' ? (
            <div className="rounded-lg border border-line px-3 py-3">
              <MoneyInput
                label={t('maintenance.closing_cost')}
                value={closingCost}
                onChange={setClosingCost}
              />
              <p className="mt-1 text-[11px] text-muted">{t('maintenance.closing_cost_hint')}</p>
            </div>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
