'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from '@pms/shared';

import { api } from '@/lib/api';
import { formatAmount, formatDate, statusTone } from '@/lib/format';
import { useAction, useAsync } from '@/lib/hooks';
import { usePreferences } from '@/lib/preferences';
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
 */
export default function MaintenancePage() {
  const { t, language, calendar } = usePreferences();
  const [status, setStatus] = useState('');
  const board = useAsync(() => api.workOrders(`?pageSize=100${status ? `&status=${status}` : ''}`), [status]);
  const properties = useAsync(() => api.properties(), []);
  const vendors = useAsync(() => api.vendors(), []);
  const [open, setOpen] = useState(false);
  const [vendorFor, setVendorFor] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [form, setForm] = useState({
    propertyId: '',
    title: '',
    description: '',
    category: 'plumbing',
    priority: 'normal' as (typeof WORK_ORDER_PRIORITIES)[number],
  });
  const [estimate, setEstimate] = useState<number | null>(null);
  const { pending, error, run } = useAction();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.createWorkOrder({
        propertyId: form.propertyId,
        title: form.title,
        description: form.description || undefined,
        category: form.category,
        priority: form.priority,
        estimatedCost: estimate === null ? undefined : { amountMinor: estimate, currency: 'ETB' },
      });
      setOpen(false);
      setForm({ propertyId: '', title: '', description: '', category: 'plumbing', priority: 'normal' });
      setEstimate(null);
      board.reload();
    }).catch(() => undefined);
  }

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

  const rows = board.data?.items ?? [];

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
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('maintenance.new_request')}
            </Button>
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
                  <Th>{t('maintenance.priority')}</Th>
                  <Th>{t('maintenance.assign_vendor')}</Th>
                  <Th>{t('money.amount')}</Th>
                  <Th>{t('unit.status')}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <tr key={order.id}>
                    <Td className="tabular text-xs text-slate-500">{order.ticketNumber}</Td>
                    <Td>
                      <span className="font-medium text-slate-900">{order.title}</span>
                      <span className="block text-[11px] text-slate-500">
                        {order.category ?? '—'} · {formatDate(order.reportedAt, { language, calendar })}
                      </span>
                    </Td>
                    <Td>
                      {order.property?.name ?? '—'}
                      {order.unit?.label ? (
                        <span className="block text-[11px] text-slate-500">{order.unit.label}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge
                        tone={
                          order.priority === 'urgent'
                            ? 'danger'
                            : order.priority === 'high'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`work_order.priority.${order.priority}` as never)}
                      </Badge>
                    </Td>
                    <Td>{order.vendor?.name ?? '—'}</Td>
                    <Td className="tabular">
                      {(order.actualCostMinor ?? order.estimatedCostMinor)
                        ? formatAmount(
                            order.actualCostMinor ?? order.estimatedCostMinor ?? '0',
                            order.currency,
                            language,
                          )
                        : '—'}
                    </Td>
                    <Td>
                      <Badge className={cn(statusTone[order.status])}>
                        {t(`work_order.status.${order.status}` as never)}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {order.status === 'open' ? (
                        <Button variant="ghost" size="sm" onClick={() => setVendorFor(order.id)}>
                          {t('maintenance.assign_vendor')}
                        </Button>
                      ) : null}
                      {order.status === 'assigned' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void advance(order.id, 'in_progress')}
                        >
                          {t('work_order.status.in_progress')}
                        </Button>
                      ) : null}
                      {order.status === 'in_progress' ? (
                        <Button variant="ghost" size="sm" onClick={() => void advance(order.id, 'completed')}>
                          {t('work_order.status.completed')}
                        </Button>
                      ) : null}
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
        title={t('maintenance.new_request')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="work-order-form" type="submit" disabled={pending}>
              {pending ? t('app.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        <form id="work-order-form" className="grid gap-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label htmlFor="propertyId">{t('nav.properties')}</Label>
            <Select
              id="propertyId"
              required
              value={form.propertyId}
              onChange={(event) => setForm((current) => ({ ...current, propertyId: event.target.value }))}
            >
              <option value="">—</option>
              {properties.data?.properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="title">{t('maintenance.title')}</Label>
            <Input
              id="title"
              required
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="category">{t('documents.category')}</Label>
              <Select
                id="category"
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              >
                {WORK_ORDER_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="priority">{t('maintenance.priority')}</Label>
              <Select
                id="priority"
                value={form.priority}
                onChange={(event) =>
                  setForm((current) => ({ ...current, priority: event.target.value as typeof form.priority }))
                }
              >
                {WORK_ORDER_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`work_order.priority.${priority}` as never)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="description">{t('common.actions')}</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </div>

          <MoneyInput
            label={`${t('money.amount')} (${t('common.optional')})`}
            value={estimate}
            onChange={setEstimate}
          />

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </form>
      </Modal>

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
    </div>
  );
}
